import { describe, expect, it } from "vitest";
import { assembleBook, clampPageTarget, planSections, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { offlineTask } from "@/lib/ai/offline";
import type { BlueprintOutput } from "@/lib/ai/tasks";
import { estimatePageCount, generatorBox, type GeneratorConfig } from "@/lib/generators/pages";
import { runPreflight } from "@/lib/preflight";
import { createProject } from "@/lib/schema/factory";
import type { BookType } from "@/lib/schema/project";

/** Fill planned sections the way autopilot does, using the offline content heuristics. */
function fill(sections: PlannedSection[]): PlannedSection[] {
  return sections.map((s) => {
    const need = s.content;
    if (!need) return s;
    const c = s.config;
    if (need.task === "journal-prompts" && c.kind === "journal-prompts") return { ...s, config: { ...c, prompts: offlineTask("journal-prompts", { topic: need.theme, audience: "adults", count: need.count }).prompts } };
    if (need.task === "word-lists" && (c.kind === "word-search" || c.kind === "word-scramble"))
      return { ...s, config: { ...c, puzzles: offlineTask("word-lists", { topic: need.theme, audience: "adults", count: need.count, wordsPerPuzzle: need.wordsPerPuzzle, maxLength: need.maxLength }).puzzles } };
    if (need.task === "phrases") {
      const phrases = offlineTask("phrases", { topic: need.theme, audience: "adults", count: need.count, maxLength: need.maxLength, style: need.style }).phrases;
      if (c.kind === "cryptogram") return { ...s, config: { ...c, phrases } };
      if (c.kind === "gratitude") return { ...s, config: { ...c, affirmations: phrases } };
    }
    return s;
  });
}

function build(bookType: BookType, topic: string, audience: string, trimId: string, pageTarget: number, bp?: BlueprintOutput) {
  const ctx = { bookType, topic, audience, notes: "" };
  const blueprint = validateBlueprint(bp ?? recipeBlueprint(ctx), ctx).blueprint;
  const planned = fill(planSections(blueprint, { ...ctx, trimId, pageTarget }));
  const sections = assembleBook(blueprint, planned, { ...ctx, trimId, pageTarget, title: "Test Book", subtitle: "A subtitle", author: "Ada Writer" });
  const project = createProject({ name: "Test Book", bookType, trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: sections });
  return { blueprint, planned, sections, project };
}

const CASES: [BookType, string, string, string, number][] = [
  ["puzzle", "large print sudoku", "seniors", "8.5x11", 120],
  ["puzzle", "ocean animals word search", "kids ages 6-9", "8.5x11", 100],
  ["puzzle", "variety puzzles", "adults", "6x9", 140],
  ["puzzle", "cryptogram puzzles", "adults", "6x9", 80],
  ["activity", "mazes and word scrambles", "kids ages 6-9", "8.5x11", 60],
  ["journal", "gratitude journal for nurses", "nurses", "6x9", 120],
  ["journal", "self-discovery journal", "women", "6x9", 160],
  ["planner", "teacher planner", "teachers", "8.5x11", 200],
  ["log-book", "fishing log book", "anglers", "6x9", 110],
  ["notebook", "dot grid notebook", "students", "6x9", 120],
];

describe("autopilot book planning", () => {
  it.each(CASES)("%s: %s builds a complete book at the target page count", (bookType, topic, audience, trimId, target) => {
    const { project, sections } = build(bookType, topic, audience, trimId, target);
    const pages = project.interior.pages;
    expect(pages.length).toBe(clampPageTarget(target));
    expect(pages.length % 2).toBe(0);
    // Every page belongs to a recorded section.
    const ids = new Set(project.interior.sections.map((s) => s.id));
    expect(pages.every((p) => p.sectionId && ids.has(p.sectionId))).toBe(true);
    expect(project.interior.sections.length).toBe(sections.length);
    // Front matter first.
    expect(pages[0].generator?.kind).toBe("title-page");
    // Content stays in the live area and nothing blocks except listing/disclosure, which autopilot fills later.
    const report = runPreflight(project);
    const failing = report.checks.filter((c) => c.status === "fail").map((c) => c.id);
    expect(failing.filter((id) => id !== "metadata" && id !== "ai-disclosure")).toEqual([]);
  });

  it("puzzle books get a how-to page, difficulty ramp, dividers and grouped answer keys at the back", () => {
    const { project, sections } = build("puzzle", "sudoku", "adults", "8.5x11", 120);
    const kinds = project.interior.pages.map((p) => p.generator?.kind);
    expect(kinds).toContain("text-page");
    expect(kinds).toContain("section-divider");
    const firstKey = kinds.indexOf("sudoku-solutions");
    const lastPuzzle = kinds.lastIndexOf("sudoku");
    expect(firstKey).toBeGreaterThan(lastPuzzle);
    const levels = sections.map((s) => ("config" in s && s.config.kind === "sudoku" ? s.config.difficulty : null)).filter(Boolean);
    expect(levels.slice(0, 4)).toEqual(["easy", "medium", "hard", "expert"]);
    // Numbering continues across sections; puzzle and answer passes share seeds.
    const body = sections.filter((s) => "config" in s && s.config.kind === "sudoku" && s.config.part === "puzzles").map((s) => ("config" in s ? s.config : s)) as Extract<GeneratorConfig, { kind: "sudoku" }>[];
    for (let i = 1; i < body.length; i++) expect(body[i].startNumber).toBe(body[i - 1].startNumber! + body[i - 1].count);
    const keys = sections.filter((s) => "config" in s && s.config.kind === "sudoku" && s.config.part === "solutions").map((s) => ("config" in s ? s.config : s)) as Extract<GeneratorConfig, { kind: "sudoku" }>[];
    expect(keys.map((k) => k.seed)).toEqual(body.map((b) => b.seed));
  });

  it("table of contents points at the right pages", () => {
    const { project, sections } = build("puzzle", "variety puzzles", "adults", "8.5x11", 140);
    const toc = sections.find((s) => "config" in s && s.config.kind === "table-of-contents");
    expect(toc).toBeDefined();
    const entries = toc && "config" in toc && toc.config.kind === "table-of-contents" ? toc.config.entries : [];
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const e of entries) {
      const p = project.interior.pages[e.page - 1];
      expect(p.generator?.kind).toBe("section-divider");
      const title = p.elements.find((el) => el.type === "text" && el.name === "Section title");
      expect(title && title.type === "text" ? title.text : "").toBe(e.title);
    }
    expect(entries.at(-1)?.title).toBe("Answer Key");
  });

  it("low-content books never get puzzle sections, even if the model proposes them", () => {
    const bp = recipeBlueprint({ bookType: "journal", topic: "travel", audience: "adults", notes: "" });
    bp.sections = [{ kind: "sudoku", title: "Sudoku", subtitle: "", theme: "", sharePercent: 50, difficulty: "easy" }, ...bp.sections];
    const checked = validateBlueprint(bp, { bookType: "journal", topic: "travel", audience: "adults", notes: "" });
    expect(checked.blueprint.sections.some((s) => s.kind === "sudoku")).toBe(false);
  });

  it("falls back to the recipe when no proposed section fits the book type", () => {
    const bp = recipeBlueprint({ bookType: "puzzle", topic: "sudoku", audience: "adults", notes: "" });
    const checked = validateBlueprint(bp, { bookType: "planner", topic: "weekly planner", audience: "adults", notes: "" });
    expect(checked.fallback).toMatch(/recipe/);
    expect(checked.blueprint.sections.map((s) => s.kind)).toContain("weekly-spread");
  });

  it("caps calendar and habit sections and gives the excess to other sections", () => {
    const { planned } = build("planner", "teacher planner", "teachers", "8.5x11", 300);
    const pages = (kind: string) => planned.filter((s) => s.kind === kind).reduce((n, s) => n + estimatePageCount(s.config), 0);
    expect(pages("monthly-calendar")).toBeLessThanOrEqual(24);
    expect(pages("habit-tracker")).toBeLessThanOrEqual(12);
    expect(pages("weekly-spread")).toBeLessThanOrEqual(53);
  });

  it("large print books use one sudoku per page and smaller word-search grids", () => {
    const { planned } = build("puzzle", "large print puzzles", "seniors", "8.5x11", 120);
    for (const s of planned) {
      if (s.config.kind === "sudoku") expect(s.config.perPage).toBe(1);
      if (s.config.kind === "word-search") expect(s.config.size).toBeLessThanOrEqual(15);
    }
  });

  it("generated pages stay inside the generator box", () => {
    const { project } = build("puzzle", "variety puzzles", "adults", "6x9", 140);
    const box = generatorBox(project.spec, project.interior.pages.length);
    const pn = 0.3 * 72; // room reserved for page numbers
    for (const p of project.interior.pages)
      for (const el of p.elements) {
        if (el.type === "line" || el.type === "pattern") continue;
        expect(el.x).toBeGreaterThanOrEqual(box.x - 12);
        expect(el.x + el.width).toBeLessThanOrEqual(box.x + box.width + 12);
        expect(el.y + el.height).toBeLessThanOrEqual(box.y + box.height + pn);
      }
  });
});
