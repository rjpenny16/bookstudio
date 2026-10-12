import { describe, expect, it } from "vitest";
import { assembleBook, planSections, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { applyContent, contentCall, refineContent, writeSection, type ContentRequest } from "@/lib/agent/content";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { needForSection } from "@/lib/agent/regenerate";
import { offlineTask } from "@/lib/ai/offline";
import { CLUE_BANK } from "@/lib/ai/offlineClues";
import { taskPrompt, TASKS } from "@/lib/ai/tasks";
import { crossingShare, generateCrossword, gridRuns, type Crossword } from "@/lib/generators/crossword";
import { crosswordsOf, estimatePageCount, generatePages, SQUARE_NUMBER, type GeneratorConfig } from "@/lib/generators/pages";
import { interiorStyle } from "@/lib/generators/style";
import { checkSectionContent, cleanCrossword, clueGivesAway } from "@/lib/quality/content";
import { puzzleStats } from "@/lib/quality/puzzles";
import { createProject } from "@/lib/schema/factory";
import type { Element } from "@/lib/schema/project";

const entries = (theme: string, n = 14) => CLUE_BANK[theme].slice(0, n).map(([answer, clue]) => ({ answer, clue }));

/** Every answer reads in the grid where the puzzle says it starts. */
function readsBack(cw: Crossword): boolean {
  return cw.words.every((w) => [...w.answer].every((ch, k) => cw.grid[w.row + (w.dir === "down" ? k : 0)][w.col + (w.dir === "across" ? k : 0)] === ch));
}

/** Squares that start an answer, numbered left to right, top to bottom, starting at 1 with no gaps. */
function numberedInOrder(cw: Crossword): boolean {
  const starts = [...new Map(cw.words.map((w) => [`${w.row},${w.col}`, w])).values()].sort((a, b) => a.row - b.row || a.col - b.col);
  return starts.every((w, i) => w.number === i + 1);
}

/** All letter squares connect into one piece. */
function connected(cw: Crossword): boolean {
  const cells = cw.grid.flatMap((row, r) => row.flatMap((ch, c) => (ch ? [`${r},${c}`] : [])));
  const seen = new Set([cells[0]]);
  const queue = [cells[0]];
  while (queue.length) {
    const [r, c] = queue.pop()!.split(",").map(Number);
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${r + dr},${c + dc}`;
      if (cw.grid[r + dr]?.[c + dc] && !seen.has(k)) {
        seen.add(k);
        queue.push(k);
      }
    }
  }
  return seen.size === cells.length;
}

describe("crossword engine", () => {
  it("interlocks every answer into one connected, correctly numbered grid with no stray words", () => {
    for (const theme of Object.keys(CLUE_BANK))
      for (const [d, n, size] of [["easy", 10, 13], ["medium", 14, 15], ["hard", 18, 17]] as const) {
        const cw = generateCrossword(entries(theme, n), size, d, 11);
        const label = `${theme} ${d}`;
        // An answer is left out only when it shares no letter with the rest (KIWI among fruits without K, I or W).
        const letters = new Set(cw.words.flatMap((w) => [...w.answer]));
        for (const sk of cw.skipped) expect([...sk].some((ch) => letters.has(ch)), `${label} ${sk}`).toBe(false);
        expect(cw.words.length + cw.skipped.length, label).toBe(n);
        expect(Math.max(cw.rows, cw.cols), label).toBeLessThanOrEqual(size);
        expect(readsBack(cw), label).toBe(true);
        expect(numberedInOrder(cw), label).toBe(true);
        expect(connected(cw), label).toBe(true);
        // Every across or down run of letters is a listed answer: nothing accidental for the solver to puzzle over.
        const answers = new Set(cw.words.map((w) => w.answer));
        expect(gridRuns(cw).filter((r) => !answers.has(r)), label).toEqual([]);
      }
  });

  it("lists across clues first, then down, each in number order", () => {
    const cw = generateCrossword(entries("Ocean"), 15, "medium", 3);
    const firstDown = cw.words.findIndex((w) => w.dir === "down");
    expect(cw.words.slice(0, firstDown).every((w) => w.dir === "across")).toBe(true);
    for (const dir of ["across", "down"] as const) {
      const nums = cw.words.filter((w) => w.dir === dir).map((w) => w.number);
      expect(nums).toEqual([...nums].sort((a, b) => a - b));
    }
  });

  it("is reproducible from its seed and differs between seeds", () => {
    const a = generateCrossword(entries("Space"), 15, "medium", 42);
    expect(generateCrossword(entries("Space"), 15, "medium", 42)).toEqual(a);
    expect(generateCrossword(entries("Space"), 15, "medium", 43).grid).not.toEqual(a.grid);
  });

  it("drops repeats, too-long answers and answers without clues, and skips what can't fit", () => {
    const cw = generateCrossword([{ answer: "apple", clue: "Fruit" }, { answer: "Apple!", clue: "Again" }, { answer: "antidisestablishment", clue: "Too long" }, { answer: "pear", clue: "" }, { answer: "plum", clue: "Purple fruit" }], 9, "easy", 1);
    expect(cw.words.map((w) => w.answer).sort()).toEqual(["APPLE", "PLUM"]);
    // Nothing shares a letter with these, so only one can go in.
    const lonely = generateCrossword([{ answer: "abc", clue: "x" }, { answer: "xyz", clue: "y" }], 9, "easy", 1);
    expect(lonely.words.length + lonely.skipped.length).toBe(2);
    expect(lonely.skipped.length).toBe(1);
  });

  it("interlocks harder puzzles at least as much as easy ones", () => {
    const share = (d: "easy" | "hard") => Object.keys(CLUE_BANK).reduce((n, t) => n + crossingShare(generateCrossword(entries(t, 12), 15, d, 5)), 0);
    expect(share("hard")).toBeGreaterThanOrEqual(share("easy"));
  });
});

describe("crossword content", () => {
  it("every offline clue passes the same checks as model output", () => {
    for (const [theme, list] of Object.entries(CLUE_BANK)) {
      expect(list.length, theme).toBeGreaterThanOrEqual(16);
      const r = cleanCrossword(list.map(([answer, clue]) => ({ answer, clue })), 11);
      expect(r.dropped, theme).toEqual([]);
    }
  });

  it("spots clues that give the answer away", () => {
    expect(clueGivesAway("Large gray animal with a trunk", "elephant")).toBe(false);
    expect(clueGivesAway("A big elephant", "elephant")).toBe(true);
    expect(clueGivesAway("More than one cat", "cats")).toBe(true);
    expect(clueGivesAway("Sunflower seeds come from it", "sun")).toBe(true);
    expect(clueGivesAway("Planted in spring", "plant")).toBe(true);
    // Short shared letters aren't a giveaway.
    expect(clueGivesAway("An ant's home", "anthill")).toBe(false);
  });

  it("the offline task matches the topic and never repeats a puzzle", () => {
    const out = offlineTask("crossword-clues", { topic: "ocean life", audience: "adults", count: 6, entriesPerPuzzle: 12, maxLength: 11, difficulty: "medium" });
    expect(out.puzzles[0].title).toBe("Ocean");
    expect(new Set(out.puzzles.map((p) => p.title)).size).toBe(6);
    expect(out.puzzles.every((p) => p.entries.length === 12)).toBe(true);
    expect(TASKS["crossword-clues"].output.safeParse(out).success).toBe(true);
  });

  it("the model prompt asks for clues without the answer at the right level", () => {
    const p = taskPrompt("crossword-clues", { topic: "birds", audience: "seniors", count: 3, entriesPerPuzzle: 10, maxLength: 9, difficulty: "easy" });
    expect(p).toMatch(/never contain the answer/);
    expect(p).toMatch(/3-9 letters/);
    expect(p).toMatch(/direct definitions/);
  });

  it("flags unusable entries in a section", () => {
    const cfg: GeneratorConfig = { kind: "crossword", puzzles: [{ title: "Bad", entries: [{ answer: "cat", clue: "A cat" }, { answer: "dog", clue: "" }] }], size: 13, difficulty: "easy", solutions: true, seed: 1 };
    const issues = checkSectionContent(cfg).map((i) => i.message);
    expect(issues.some((m) => /gives the answer away/.test(m))).toBe(true);
    expect(issues.some((m) => /only 0 usable/.test(m))).toBe(true);
  });
});

describe("crossword pages", () => {
  const spec = createProject({ name: "X", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false }).spec;
  const cfg: GeneratorConfig = { kind: "crossword", puzzles: ["Animals", "Fruits", "Garden", "Ocean", "Space"].map((t) => ({ title: t, entries: entries(t, 10) })), size: 13, difficulty: "easy", solutions: true, seed: 9 };
  const texts = (els: Element[]) => els.filter((e): e is Extract<Element, { type: "text" }> => e.type === "text");

  it("prints one crossword a page with its clues and word bank, then a solutions page and keys four to a page", () => {
    const pages = generatePages(cfg, { spec, pageCountHint: 20 });
    expect(pages).toHaveLength(estimatePageCount(cfg));
    expect(pages.filter((p) => p.generator?.kind === "crossword")).toHaveLength(5);
    expect(pages.filter((p) => p.generator?.kind === "crossword-solutions")).toHaveLength(1 + 2);
    const first = texts(pages[0].elements).map((t) => t.text);
    expect(first).toContain("Across");
    expect(first).toContain("Down");
    expect(first.some((t) => t.startsWith("Word bank: "))).toBe(true);
    const cw = crosswordsOf(cfg)[0].cw;
    for (const w of cw.words) expect(first).toContain(w.clue);
  });

  it("keeps squares big enough to write in and everything inside the page", () => {
    const pages = generatePages({ ...cfg, difficulty: "hard", puzzles: cfg.puzzles.map((p, i) => ({ ...p, entries: entries(["Animals", "Fruits", "Garden", "Ocean", "Space"][i], 18) })), size: 15 }, { spec, pageCountHint: 20 });
    for (const p of pages.filter((x) => x.generator?.kind === "crossword")) {
      const squares = p.elements.filter((e) => e.type === "rect");
      expect(Math.min(...squares.map((s) => s.width))).toBeGreaterThanOrEqual(20);
      for (const e of p.elements) expect(e.y + e.height).toBeLessThanOrEqual(11 * 72);
    }
  });

  it("uses the large-print sizes for clues", () => {
    const pages = generatePages(cfg, { spec, pageCountHint: 20, style: interiorStyle({ genre: "large-print" }) });
    expect(Math.min(...texts(pages[0].elements).filter((t) => t.name !== SQUARE_NUMBER).map((t) => t.fontSize))).toBeGreaterThanOrEqual(14);
  });
});

describe("crossword books", () => {
  const offlineAsk = async (req: ContentRequest) => {
    const { task, input } = contentCall(req, { audience: "adults", bookTitle: "Test" });
    return { output: offlineTask(task, input as never) };
  };

  it("plans, writes and lays out a crossword book offline, harder sections with more answers", async () => {
    const ctx = { bookType: "puzzle" as const, topic: "crossword puzzles", audience: "adults", notes: "" };
    const bp = validateBlueprint(recipeBlueprint(ctx), ctx).blueprint;
    expect(bp.sections.map((s) => s.kind)).toEqual(["crossword", "crossword", "crossword"]);
    const planned = planSections(bp, { ...ctx, trimId: "8.5x11", pageTarget: 100 });
    const written: PlannedSection[] = [];
    for (const s of planned) written.push({ ...s, config: (await writeSection(s, offlineAsk)).config });
    const refined = (await refineContent(written, offlineAsk)).sections;
    const sizes = refined.map((s) => (s.config.kind === "crossword" ? s.config.size : 0));
    expect(sizes[2]).toBeGreaterThan(sizes[0]);
    const sections = assembleBook(bp, refined, { ...ctx, trimId: "8.5x11", pageTarget: 100, title: "Crosswords", subtitle: "", author: "A" });
    const project = createProject({ name: "Crosswords", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, interior: sections });
    expect(project.interior.pages.length).toBe(100);
    const stats = puzzleStats(project).crossword;
    expect(stats).toHaveLength(3);
    for (const s of stats) {
      // Now and then an answer can't cross any other in a tight easy grid; its clue is simply left out.
      expect(s.skipped / (s.count * s.avgWords)).toBeLessThan(0.02);
      expect(s.strayRuns).toBe(0);
      expect(s.count).toBeGreaterThan(5);
    }
    expect(stats[2].avgWords).toBeGreaterThan(stats[0].avgWords);
    // Numbering runs on across sections.
    const cfgs = project.interior.sections.filter((s) => s.config.kind === "crossword" && s.config.part === "puzzles").map((s) => s.config as Extract<GeneratorConfig, { kind: "crossword" }>);
    expect(cfgs[1].startNumber).toBe(1 + cfgs[0].puzzles.length);
    // The first divider explains the rules and mentions the word bank on easy puzzles.
    const div = project.interior.sections.find((s) => s.config.kind === "section-divider")!.config as Extract<GeneratorConfig, { kind: "section-divider" }>;
    expect(div.howTo).toMatch(/word bank/);
  });

  it("puts model output into a section and regenerates with the same request", () => {
    const cfg: GeneratorConfig = { kind: "crossword", puzzles: [], size: 15, difficulty: "medium", solutions: true, seed: 1 };
    const need = needForSection({ ...cfg, puzzles: [{ title: "A", entries: entries("Birds", 14) }] }, "birds")!;
    expect(need).toMatchObject({ task: "crossword-clues", entriesPerPuzzle: 14, difficulty: "medium" });
    const out = offlineTask("crossword-clues", { topic: "birds", audience: "adults", count: 2, entriesPerPuzzle: 14, maxLength: 11 });
    const applied = applyContent(cfg, need, out, "run_1");
    expect(applied.kind === "crossword" && applied.puzzles.length).toBe(1);
    expect("aiRunId" in applied && applied.aiRunId).toBe("run_1");
  });
});
