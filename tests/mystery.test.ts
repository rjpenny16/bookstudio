import { describe, expect, it } from "vitest";
import { assembleMystery, BUILT_IN_CASES, checkMysteryPlan, ensureSecret, mysterySizing, mysteryStyle, planMystery, writeMystery, type MysteryAsk, type MysteryInput } from "@/lib/agent/mystery";
import { pool } from "@/lib/agent/content";
import { inferSetup } from "@/lib/agent/setup";
import { offlineTask } from "@/lib/ai/offline";
import { TASKS, type MysteryPlanOutput } from "@/lib/ai/tasks";
import { genreOf } from "@/lib/cover/genres";
import { crosswordsOf, estimatePageCount, generatePages, type GeneratorConfig } from "@/lib/generators/pages";
import { secretOrder } from "@/lib/generators/scramble";
import { generateWordSearch, leftoverLetters, normalizeWord } from "@/lib/generators/wordsearch";
import { runPreflight } from "@/lib/preflight";
import { createProject } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";

/** The autopilot's model calls, answered by the offline provider (validated against the task schemas, as the server does). */
const offlineAsk: MysteryAsk = async (task, input) => {
  const output = offlineTask(task, input);
  TASKS[task].output.parse(output);
  return { output };
};
const serial = <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>) => pool(items, 2, fn);

async function buildMystery(i: MysteryInput) {
  const z = mysterySizing(i);
  const planned = await planMystery(offlineAsk, z, i);
  const written = await writeMystery(offlineAsk, planned.plan, z, i.audience, serial);
  const book = assembleMystery(planned.plan, written.chapters, written.reveal, z, { ...i, subtitle: "A Whodunit Puzzle Book", author: "Ada Writer" });
  const project = createProject({ name: i.title, bookType: "mystery", trimId: i.trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: book.sections, style: mysteryStyle(i) });
  return { z, planned, written, book, project };
}

const texts = (project: Project, sectionLabel: RegExp) => {
  const ids = new Set(project.interior.sections.filter((s) => sectionLabel.test(s.label)).map((s) => s.id));
  return project.interior.pages.filter((p) => p.sectionId && ids.has(p.sectionId)).flatMap((p) => p.elements.filter((e): e is TextElement => e.type === "text").map((e) => e.text));
};

const base: MysteryInput = { topic: "Murder mystery puzzle book at a country manor", audience: "Adults who love cozy mysteries", notes: "", angle: "", title: "Death at the Manor", trimId: "8.5x11", pageTarget: 60, difficulty: "medium" };

describe("mystery setup", () => {
  it("infers the mystery book type before the puzzle type", () => {
    expect(inferSetup("Murder mystery puzzle book", "adults").bookType).toBe("mystery");
    expect(inferSetup("Detective whodunit with word searches", "teens").bookType).toBe("mystery");
    expect(inferSetup("Word search puzzles", "adults").bookType).toBe("puzzle");
    expect(inferSetup("Murder mystery puzzle book", "adults").trimId).toBe("8.5x11");
  });

  it("gets a noir cover genre, or the kids' look for children", () => {
    expect(genreOf({ bookType: "mystery", topic: "murder mystery", audience: "adults" }).id).toBe("mystery");
    expect(genreOf({ bookType: "mystery", topic: "detective mystery", audience: "kids ages 8-12" }).id).toBe("kids");
  });

  it("sizes the case to the page target", () => {
    const small = mysterySizing({ ...base, pageTarget: 40 });
    const big = mysterySizing({ ...base, pageTarget: 120 });
    expect(small.chapters).toBeGreaterThanOrEqual(6);
    expect(big.chapters * (big.cluesPerChapter + big.storyPages)).toBeGreaterThan(small.chapters * (small.cluesPerChapter + small.storyPages));
    expect(mysterySizing({ ...base, audience: "kids ages 8-12" }).kinds).not.toContain("cryptogram");
    expect(mysterySizing({ ...base, audience: "kids ages 8-12" }).difficulty).toBe("easy");
  });
});

describe("the case plan", () => {
  const z = mysterySizing(base);

  it.each(BUILT_IN_CASES.map((c) => [c.plan.caseTitle, c] as const))("built-in case %s passes the fair-play check", (_, c) => {
    const r = checkMysteryPlan(c.plan, z);
    expect(r.problems).toEqual([]);
    expect(r.fatal).toBe(false);
    expect(c.chapters).toHaveLength(c.plan.chapters.length);
    // Every chapter's puzzles match its clues, and each puzzle can hide its clue.
    c.plan.chapters.forEach((ch, n) => {
      expect(c.chapters[n].puzzles).toHaveLength(ch.clues.length);
      ch.clues.forEach((cl, k) => {
        const p = c.chapters[n].puzzles[k];
        if (cl.kind === "word-scramble") expect(secretOrder(p.words, cl.answer), `${cl.answer} from ${p.words}`).not.toBeNull();
        if (cl.kind === "crossword") expect(p.entries.map((e) => e.answer)).toContain(cl.answer);
        if (cl.kind === "word-search") expect(p.words.length).toBeGreaterThanOrEqual(8);
      });
    });
  });

  const plan = (): MysteryPlanOutput => structuredClone(BUILT_IN_CASES[0].plan);

  it("rejects a culprit who isn't a suspect", () => {
    const p = plan();
    p.culprit = "The Butler";
    const r = checkMysteryPlan(p, z);
    expect(r.fatal).toBe(true);
    expect(r.problems.join(" ")).toMatch(/not one of the suspects/);
  });

  it("asks for clues against the culprit and a clue clearing every innocent suspect", () => {
    const p = plan();
    for (const ch of p.chapters) ch.clues = ch.clues.filter((cl) => !(cl.suspect === "Victor Lane" && cl.effect === "implicates") && cl.suspect !== "Agnes Pell");
    const r = checkMysteryPlan(p, z);
    expect(r.problems.join(" ")).toMatch(/point at the culprit/);
    expect(r.problems.join(" ")).toMatch(/Nothing clears Agnes Pell/);
  });

  it("flags answers a puzzle can't hide and answers that name a suspect", () => {
    const p = plan();
    p.chapters[0].clues[0] = { ...p.chapters[0].clues[0], kind: "crossword", answer: "TWO WORDS" };
    p.chapters[1].clues[0] = { ...p.chapters[1].clues[0], kind: "word-scramble", answer: "BRIGGS" };
    const r = checkMysteryPlan(p, z);
    expect(r.problems.join(" ")).toMatch(/one word/);
    expect(r.problems.join(" ")).toMatch(/names a suspect/);
  });

  it("re-plans once with the problems, and falls back to a built-in case when the plan can't be built", async () => {
    const asked: unknown[] = [];
    const bad: MysteryAsk = async (task, input, outputs) => {
      asked.push(input);
      if (task === "mystery-plan") return { output: { ...plan(), culprit: "Nobody" } as never };
      return offlineAsk(task, input, outputs);
    };
    const r = await planMystery(bad, z, base);
    expect(asked).toHaveLength(2);
    expect((asked[1] as { problems?: string[] }).problems?.join(" ")).toMatch(/not one of the suspects/);
    expect(r.plan.culprit).toBe(BUILT_IN_CASES[0].plan.culprit);
    expect(r.notes.join(" ")).toMatch(/built-in case/);
  });
});

describe("clue puzzles", () => {
  it("hides a word search's message in its leftover letters, spread over the grid", () => {
    const ws = generateWordSearch(["CANDLE", "NAPKIN", "SILVER", "GOBLET", "PLATTER", "SOUP", "LADLE", "TUREEN"], 12, "medium", 42, undefined, "CHECK THE DECANTER");
    expect(ws.message).toBe("CHECKTHEDECANTER");
    expect(ws.placed).toHaveLength(8);
    const step = ws.messageStep!;
    expect(step).toBeGreaterThan(1);
    const left = leftoverLetters(ws);
    expect(Array.from({ length: 16 }, (_, k) => left[(k + 1) * step - 1]).join("")).toBe("CHECKTHEDECANTER");
    // Not in plain sight: no row reads the message's first word.
    expect(ws.grid.some((row) => row.join("").includes("CHECK"))).toBe(false);
  });

  it("orders scramble words so their shaded letters spell the secret", () => {
    const r = secretOrder(["LADLE", "KETTLE", "PUDDING", "GRAVY", "OVEN", "BREAD", "PANTRY"], "LEDGER")!;
    expect(r).not.toBeNull();
    expect(r.marks.map((m, k) => r.words[k][m]).join("")).toBe("LEDGER");
    expect(secretOrder(["CAT", "DOG"], "QUIZ")).toBeNull();
    // Bank words are added for letters the list lacks.
    expect(secretOrder(ensureSecret(["CAT", "DOG", "BIRD"], "ZEBRA"), "ZEBRA")).not.toBeNull();
  });

  it("always places a crossword's key answer", () => {
    const cfg: GeneratorConfig = { kind: "crossword", puzzles: [{ title: "The Study", entries: BUILT_IN_CASES[0].chapters[1].puzzles[0].entries, key: "WINDOW" }], size: 13, difficulty: "medium", solutions: true, seed: 7 };
    for (let seed = 1; seed < 15; seed++) expect(crosswordsOf({ ...cfg, seed })[0].cw.words.map((w) => w.answer)).toContain("WINDOW");
  });
});

describe("a whole mystery book", () => {
  it.each([
    ["8.5x11", 60, "country manor"],
    ["6x9", 80, "seaside hotel"],
    ["8.5x11", 48, "large print cozy mystery for seniors"],
  ] as const)("%s, %i pages (%s) builds, numbers its clues and passes preflight", async (trimId, pageTarget, topic) => {
    const i = { ...base, trimId, pageTarget, topic: `Murder mystery at a ${topic}`, audience: /seniors/.test(topic) ? "Seniors" : base.audience };
    const { book, project, planned } = await buildMystery(i);
    const pages = project.interior.pages;
    expect(pages.length).toBeGreaterThanOrEqual(pageTarget);
    expect(pages.length % 2).toBe(0);
    expect(pages.length).toBe(book.sections.reduce((n, s) => n + estimatePageCount("config" in s ? s.config : s), 0));

    // Every chapter is followed by its clue puzzles, numbered 1, 2, 3... through the book.
    const clueCount = planned.plan.chapters.reduce((n, c) => n + c.clues.length, 0);
    const puzzleLabels = project.interior.sections.filter((s) => /^Puzzle \d+/.test(s.label)).map((s) => Number(s.label.match(/^Puzzle (\d+)/)![1]));
    expect(puzzleLabels).toEqual(Array.from({ length: clueCount }, (_, k) => k + 1));
    expect(project.interior.sections.filter((s) => s.config.kind === "story")).toHaveLength(planned.plan.chapters.length + 1);

    // Each clue shows up in the answer key, so a stuck reader can check it.
    const key = texts(project, /^Answers:/).join(" ");
    for (const cl of planned.plan.chapters.flatMap((c) => c.clues).filter((c) => c.kind !== "cryptogram")) expect(key).toContain(cl.kind === "word-search" ? cl.answer : normalizeWord(cl.answer));

    // Puzzle pages carry a Case clue box, and the solution sits after the answer key.
    const labels = project.interior.sections.map((s) => s.label);
    expect(labels.indexOf("The solution")).toBeGreaterThan(labels.indexOf("Answer key"));
    expect(texts(project, /^Puzzle /).filter((t) => t === "CASE CLUE").length).toBe(planned.plan.chapters.flatMap((c) => c.clues).filter((c) => c.kind !== "cryptogram").length);

    // The contents list every chapter.
    const toc = project.interior.sections.find((s) => s.config.kind === "table-of-contents")!.config;
    expect(toc.kind === "table-of-contents" && toc.entries.length).toBe(planned.plan.chapters.length + 5);

    // No spoilers in the listing summary.
    expect(book.summary).not.toContain(planned.plan.culprit);

    const report = runPreflight(project);
    // The listing and AI disclosure are filled in by later autopilot steps.
    expect(report.checks.filter((c) => c.status === "fail" && c.id !== "metadata" && c.id !== "ai-disclosure").map((c) => c.title)).toEqual([]);
  });

  it("fits each chapter's story on its pages", async () => {
    const { project } = await buildMystery({ ...base, trimId: "6x9", pageTarget: 64 });
    for (const sec of project.interior.sections.filter((s) => s.config.kind === "story")) {
      if (sec.config.kind !== "story") continue;
      const pages = generatePages(sec.config, { spec: project.spec, pageCountHint: project.interior.pages.length });
      expect(pages).toHaveLength(sec.config.pages);
      const words = pages.flatMap((p) => p.elements.filter((e): e is TextElement => e.type === "text" && e.name === "Story")).map((e) => e.text).join(" ").split(/\s+/).filter(Boolean).length;
      expect(words).toBe(sec.config.body.split(/\s+/).filter(Boolean).length);
    }
  });
});
