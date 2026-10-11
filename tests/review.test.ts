import { describe, expect, it } from "vitest";
import { assembleBook, planSections, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { contentCall, type ContentAsk } from "@/lib/agent/content";
import { estimateRun } from "@/lib/agent/estimate";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { canRegenerate, regenerateSection, replaceSections, shiftDifficulty } from "@/lib/agent/regenerate";
import { inferSetup } from "@/lib/agent/setup";
import { offlineTask } from "@/lib/ai/offline";
import { TASKS } from "@/lib/ai/tasks";
import { restyleOffline } from "@/lib/cover/restyle";
import { estimatePageCount, type GeneratorConfig } from "@/lib/generators/pages";
import { runPreflight } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { qualityReport } from "@/lib/quality";
import { checkBookContent } from "@/lib/quality/content";
import { scorecard } from "@/lib/quality/scorecard";
import { createProject } from "@/lib/schema/factory";
import type { BookType, Project } from "@/lib/schema/project";

/** Answer content requests the way the offline provider would. */
const offlineAsk: ContentAsk = async (req) => {
  const c = contentCall(req, { audience: "adults", bookTitle: "Test Book" });
  // The request must be valid input for its task, feedback included.
  expect(TASKS[c.task].input.safeParse(c.input).success).toBe(true);
  return { output: offlineTask(c.task, c.input as never) };
};

async function book(bookType: BookType, topic: string, audience: string, trimId: string, pageTarget: number): Promise<Project> {
  const ctx = { bookType, topic, audience, notes: "" };
  const bp = validateBlueprint(recipeBlueprint(ctx), ctx).blueprint;
  const filled: PlannedSection[] = [];
  for (const s of planSections(bp, { ...ctx, trimId, pageTarget })) {
    if (!s.content) {
      filled.push(s);
      continue;
    }
    const { output } = await offlineAsk({ need: s.content, sectionTitle: s.label, count: s.content.count, avoid: filled.flatMap((f) => ("prompts" in f.config ? f.config.prompts : [])) });
    const { applyContent } = await import("@/lib/agent/content");
    filled.push({ ...s, config: applyContent(s.config, s.content, output, undefined) });
  }
  const sections = assembleBook(bp, filled, { ...ctx, trimId, pageTarget, title: "Test Book", subtitle: "A subtitle", author: "Ada Writer" });
  return createProject({ name: "Test Book", bookType, trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: sections });
}

const body = (p: Project, kind: GeneratorConfig["kind"]) => p.interior.sections.find((s) => s.role === "body" && s.config.kind === kind && canRegenerate(s))!;
const pagesOf = (p: Project, id: string) => p.interior.pages.filter((x) => x.sectionId === id);

describe("one-screen start", () => {
  it.each([
    ["large print sudoku", "seniors", "puzzle", "8.5x11"],
    ["ocean animals word search", "kids ages 6-9", "puzzle", "8.5x11"],
    ["gratitude journal for nurses", "nurses", "journal", "6x9"],
    ["fishing log book", "anglers", "log-book", "6x9"],
    ["teacher lesson planner", "teachers", "planner", "8.5x11"],
    ["dot grid notebook", "students", "notebook", "6x9"],
    ["dinosaur activity book", "kids ages 4-6", "activity", "8.5x11"],
    ["morning reflections", "busy parents", "journal", "6x9"],
  ])("infers %s for %s", (topic, audience, bookType, trimId) => {
    const s = inferSetup(topic, audience);
    expect(s.bookType).toBe(bookType);
    expect(s.trimId).toBe(trimId);
    expect(s.reasons.bookType).toBeTruthy();
  });

  it("estimates nothing offline and counts paid images with art", () => {
    expect(estimateRun({ bookType: "journal", provider: "offline", coverArt: true })).toMatchObject({ offline: true, images: 0, modelCalls: [0, 0] });
    const withArt = estimateRun({ bookType: "journal", provider: "anthropic", coverArt: true });
    const without = estimateRun({ bookType: "journal", provider: "anthropic", coverArt: false });
    expect(withArt.images).toBe(4);
    expect(without.images).toBe(0);
    expect(withArt.modelCalls[0]).toBeGreaterThan(without.modelCalls[0]);
    expect(withArt.tokens[1]).toBeGreaterThan(withArt.tokens[0]);
  });
});

describe("regenerate with feedback", () => {
  it("shifts difficulty one step only when asked", () => {
    const sudoku: GeneratorConfig = { kind: "sudoku", count: 10, difficulty: "hard", perPage: 2, solutions: true, seed: 1 };
    expect(shiftDifficulty(sudoku, "harder puzzles please")).toMatchObject({ difficulty: "expert" });
    expect(shiftDifficulty({ ...sudoku, difficulty: "expert" }, "make it harder")).toMatchObject({ difficulty: "expert" });
    expect(shiftDifficulty(sudoku, "these are too hard")).toMatchObject({ difficulty: "medium" });
    expect(shiftDifficulty(sudoku, "more about birds")).toBe(sudoku);
  });

  it("gives a sudoku section new, harder puzzles and keeps its answer key in step", async () => {
    const p = await book("puzzle", "large print sudoku", "seniors", "8.5x11", 120);
    const sec = body(p, "sudoku");
    const before = sec.config.kind === "sudoku" ? sec.config : null;
    const r = await regenerateSection(p, sec.id, "harder please", offlineAsk);
    const after = r.project.interior.sections.find((s) => s.id === sec.id)!.config;
    expect(after.kind === "sudoku" && after.difficulty).not.toBe(before!.difficulty);
    expect(after.kind === "sudoku" && after.seed).not.toBe(before!.seed);
    const key = r.project.interior.sections.find((s) => s.label === `${sec.label}: answers`)!;
    expect(key.config.kind === "sudoku" && key.config.seed).toBe(after.kind === "sudoku" && after.seed);
    expect(key.config.kind === "sudoku" && key.config.part).toBe("solutions");
    expect(r.project.interior.pages.length).toBe(p.interior.pages.length);
    expect(pagesOf(r.project, sec.id).map((x) => x.id)).not.toEqual(pagesOf(p, sec.id).map((x) => x.id));
    // Other sections are untouched.
    const other = p.interior.sections.find((s) => s.role === "body" && s.id !== sec.id && s.config.kind === "sudoku")!;
    expect(pagesOf(r.project, other.id)).toEqual(pagesOf(p, other.id));
    expect(r.summary).toMatch(/Difficulty: \w+ → \w+/);
  });

  it("rewrites word lists without repeating the rest of the book", async () => {
    const p = await book("puzzle", "ocean animals word search", "kids ages 6-9", "8.5x11", 100);
    const sec = body(p, "word-search");
    const r = await regenerateSection(p, sec.id, "more about the deep sea", offlineAsk);
    const cfg = r.project.interior.sections.find((s) => s.id === sec.id)!.config;
    const old = sec.config.kind === "word-search" ? sec.config.puzzles : [];
    expect(cfg.kind === "word-search" && cfg.puzzles.length).toBe(old.length);
    expect(cfg.kind === "word-search" && cfg.puzzles.map((x) => x.title)).not.toEqual(old.map((x) => x.title));
    expect(r.project.interior.pages.length).toBe(p.interior.pages.length);
    const repeats = checkBookContent(r.project.interior.sections).flatMap((s) => s.issues).filter((i) => i.severity === "high");
    expect(repeats).toEqual([]);
  });

  it("keeps a journal section's page count when the model comes up short", async () => {
    const p = await book("journal", "reflection journal for nurses", "nurses", "6x9", 120);
    const sec = p.interior.sections.find((s) => s.config.kind === "journal-prompts")!;
    const short: ContentAsk = async () => ({ output: { prompts: ["Describe the quietest five minutes of your last shift and what you noticed in them."] }, runId: "run_x" });
    const r = await regenerateSection(p, sec.id, "shorter prompts", short);
    const cfg = r.project.interior.sections.find((s) => s.id === sec.id)!.config;
    expect(cfg.kind === "journal-prompts" && cfg.prompts[0]).toMatch(/quietest five minutes/);
    expect(cfg.kind === "journal-prompts" && cfg.aiRunId).toBe("run_x");
    expect(pagesOf(r.project, sec.id).length).toBe(pagesOf(p, sec.id).length);
    expect(r.summary).toMatch(/Rewrote 1 of \d+ item\(s\); kept \d+ earlier/);
  });

  it("refuses sections with nothing to regenerate", async () => {
    const p = await book("journal", "gratitude journal for nurses", "nurses", "6x9", 120);
    const title = p.interior.sections.find((s) => s.config.kind === "title-page")!;
    expect(canRegenerate(title)).toBe(false);
    await expect(regenerateSection(p, title.id, "x", offlineAsk)).rejects.toThrow(/can't be regenerated/);
  });

  it("moves contents entries when a section changes length", async () => {
    const p = await book("puzzle", "large print sudoku", "seniors", "8.5x11", 120);
    const toc = p.interior.sections.find((s) => s.config.kind === "table-of-contents")!;
    const sec = body(p, "sudoku");
    const cfg = sec.config.kind === "sudoku" ? { ...sec.config, count: sec.config.count + 4 } : sec.config;
    const grown = estimatePageCount(cfg) - estimatePageCount(sec.config);
    const next = replaceSections(p, new Map([[sec.id, cfg]]));
    expect(next.interior.pages.length).toBe(p.interior.pages.length + grown);
    const before = toc.config.kind === "table-of-contents" ? toc.config.entries : [];
    const after = next.interior.sections.find((s) => s.id === toc.id)!.config;
    const start = p.interior.pages.findIndex((x) => x.sectionId === sec.id) + 1;
    expect(after.kind === "table-of-contents" && after.entries.map((e) => e.page)).toEqual(before.map((e) => (e.page > start ? e.page + grown : e.page)));
  });

  it("restyles a vector cover from feedback words offline", () => {
    expect(restyleOffline("make it more playful and bright", "band", "midnight")).toMatchObject({ template: "playful", palette: "sunny" });
    expect(restyleOffline("darker colors", "framed", "sage")).toMatchObject({ template: "framed", palette: "midnight" });
    // Nothing recognized: still a visible change.
    expect(restyleOffline("hmm", "band", "midnight")).toMatchObject({ template: "band", palette: "sage" });
  });
});

describe("scorecard", () => {
  it("needs the disclosure confirmed, offers fixes, and ignores offline reviews", async () => {
    let p = await book("journal", "gratitude journal for nurses", "nurses", "6x9", 120);
    const card = (x: Project) => scorecard(x, runPreflight(x), qualityReport(x));
    const first = card(p);
    expect(first.ready).toBe(false);
    expect(first.rows.find((r) => r.id === "disclosure")).toMatchObject({ status: "fail", points: 0 });
    expect(first.rows.map((r) => r.max).reduce((a, b) => a + b)).toBe(100);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(90);

    p = applyFix(p, "suggest-ai-disclosure");
    p = { ...p, metadata: { ...p.metadata, title: "Shift Notes", description: "A gratitude journal for nurses. ".repeat(20), keywords: ["nurse gift"], aiDisclosure: { ...p.metadata.aiDisclosure, confirmed: true } } };
    const second = card(p);
    expect(second.rows.find((r) => r.id === "disclosure")).toMatchObject({ status: "pass", points: 10 });
    expect(second.score).toBeGreaterThan(first.score);

    // An offline "review" has no score to trust, so it doesn't cap the design row.
    const offline = { ...p, reviews: { visual: { at: "", provider: "offline", model: "heuristic-v1", score: 0, summary: "", findings: [], thumbnailReadable: true, images: [] } } };
    expect(card(offline).rows.find((r) => r.id === "design")!.points).toBe(second.rows.find((r) => r.id === "design")!.points);
    const poor = { ...p, reviews: { visual: { ...offline.reviews.visual, provider: "anthropic", score: 3 } } };
    expect(card(poor).rows.find((r) => r.id === "design")!.points).toBeLessThanOrEqual(6);
  });
});
