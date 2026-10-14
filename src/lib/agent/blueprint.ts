import type { BlueprintOutput, SectionKind } from "@/lib/ai/tasks";
import { estimatePageCount, puzzleCount, type GeneratorConfig } from "@/lib/generators/pages";
import { randomSeed } from "@/lib/generators/rng";
import { findTrim } from "@/lib/kdp/geometry";
import type { SectionInput } from "@/lib/schema/factory";
import { wordSearchMaxLength } from "@/lib/quality/content";
import { isLowContent, type BookType } from "@/lib/schema/project";
import { recipeBlueprint } from "./recipes";

/**
 * Turns a blueprint (model-proposed or recipe) into a fully specified interior.
 * Everything here is deterministic: the model only chooses kinds, themes and
 * shares; page counts, numbering, answer keys and padding are computed.
 */

export const MIN_PAGES = 24;
export const MAX_PAGES = 300;
const MAX_SECTIONS = 6;

export const PUZZLE_KINDS: SectionKind[] = ["sudoku", "word-search", "number-search", "maze", "word-scramble", "cryptogram", "crossword"];
export const LOW_CONTENT_KINDS: SectionKind[] = ["journal-prompts", "free-write", "gratitude", "daily-planner", "weekly-spread", "monthly-calendar", "habit-tracker", "log", "dot-grid", "graph"];

/** Most pages a section kind should get before the rest of the budget goes elsewhere. */
const KIND_CAP: Partial<Record<SectionKind, number>> = { "monthly-calendar": 24, "habit-tracker": 12, "weekly-spread": 53, "journal-prompts": 200 };

export function allowedKinds(bookType: BookType): SectionKind[] {
  if (bookType === "puzzle" || bookType === "activity") return [...PUZZLE_KINDS, "free-write"];
  if (isLowContent(bookType)) return LOW_CONTENT_KINDS;
  return [...LOW_CONTENT_KINDS, ...PUZZLE_KINDS];
}

export function clampPageTarget(n: number): number {
  const t = Math.max(MIN_PAGES, Math.min(MAX_PAGES, Math.round(n || 120)));
  return t % 2 ? t + 1 : t;
}

export interface BlueprintContext {
  bookType: BookType;
  topic: string;
  audience: string;
  notes: string;
}

/**
 * Keep only usable sections. Returns the recipe instead when nothing usable is
 * left, and says why in `fallback`.
 */
export function validateBlueprint(bp: BlueprintOutput, ctx: BlueprintContext): { blueprint: BlueprintOutput; fallback: string | null } {
  const allowed = allowedKinds(ctx.bookType);
  const sections = bp.sections
    .filter((s) => allowed.includes(s.kind))
    .slice(0, MAX_SECTIONS)
    .map((s) => ({ ...s, title: s.title.trim().slice(0, 40) || s.kind, subtitle: s.subtitle.trim().slice(0, 120), sharePercent: Math.max(1, Math.min(100, Math.round(s.sharePercent) || 1)) }));
  if (!sections.length) {
    const recipe = recipeBlueprint(ctx);
    return { blueprint: { ...recipe, howToUse: bp.howToUse.body.trim() ? bp.howToUse : recipe.howToUse, closing: bp.closing.body.trim() ? bp.closing : recipe.closing }, fallback: "The plan had no sections that fit this book type; used the built-in recipe." };
  }
  const startDate = /^\d{4}-\d{2}$/.test(bp.startDate.trim()) ? bp.startDate.trim() : "";
  const logColumns = bp.logColumns.map((c) => c.trim()).filter(Boolean).slice(0, 6);
  return { blueprint: { ...bp, sections, startDate, logColumns }, fallback: null };
}

/** Content a section needs from a model (or offline heuristics) before it can be generated. */
export type ContentNeed =
  | { task: "journal-prompts"; theme: string; count: number }
  | { task: "word-lists"; theme: string; count: number; wordsPerPuzzle: number; maxLength: number; difficulty?: "easy" | "medium" | "hard" }
  | { task: "crossword-clues"; theme: string; count: number; entriesPerPuzzle: number; maxLength: number; difficulty: "easy" | "medium" | "hard" }
  | { task: "phrases"; theme: string; count: number; maxLength: number; style: "saying" | "affirmation" };

export interface PlannedSection {
  label: string;
  subtitle: string;
  kind: SectionKind;
  config: GeneratorConfig;
  content: ContentNeed | null;
}

export interface PlanInput extends BlueprintContext {
  trimId: string;
  pageTarget: number;
}

export interface Sizing {
  largePrint: boolean;
  wideTrim: boolean;
}

/** Grid sizes by difficulty: each step up is a bigger grid on every trim, so medium and hard never come out the same. */
const WS_SIZE = {
  wide: { easy: 12, medium: 15, hard: 18 },
  narrow: { easy: 11, medium: 13, hard: 15 },
  wideLarge: { easy: 11, medium: 13, hard: 15 },
  narrowLarge: { easy: 10, medium: 12, hard: 13 },
} as const;
const NS_SIZE = { wide: { easy: 12, medium: 14, hard: 16 }, narrow: { easy: 11, medium: 13, hard: 14 } } as const;
/** Most crossword squares across or down: room for more answers as puzzles get harder, fewer and bigger squares in large print. */
const CW_SIZE = {
  wide: { easy: 13, medium: 15, hard: 17 },
  narrow: { easy: 11, medium: 13, hard: 15 },
  wideLarge: { easy: 11, medium: 13, hard: 13 },
  narrowLarge: { easy: 9, medium: 11, hard: 11 },
} as const;
/** Answers per crossword. */
const CW_ENTRIES = { easy: 10, medium: 14, hard: 18 } as const;
const wsSize = (z: Sizing, d: "easy" | "medium" | "hard") => WS_SIZE[`${z.wideTrim ? "wide" : "narrow"}${z.largePrint ? "Large" : ""}`][d];

const capDifficulty = (d: BlueprintOutput["sections"][number]["difficulty"]): "easy" | "medium" | "hard" => (d === "expert" ? "hard" : d);

/** A puzzle config holding `n` puzzles, with placeholder content (real content is filled in later). */
export function puzzleConfig(kind: SectionKind, n: number, difficulty: BlueprintOutput["sections"][number]["difficulty"], z: Sizing): GeneratorConfig {
  const d = capDifficulty(difficulty);
  const seed = randomSeed();
  switch (kind) {
    case "sudoku":
      // Large print: one puzzle a page, and four solved grids a page in the key so its digits stay readable.
      return { kind: "sudoku", count: n, difficulty, perPage: z.largePrint ? 1 : 2, ...(z.largePrint ? { keysPerPage: 4 as const } : {}), solutions: true, seed };
    case "word-search": {
      const size = wsSize(z, d);
      return { kind: "word-search", puzzles: Array.from({ length: n }, (_, i) => ({ title: `Puzzle ${i + 1}`, words: ["ABC"] })), size, difficulty: d, solutions: true, seed };
    }
    case "number-search":
      return { kind: "number-search", count: n, size: NS_SIZE[z.wideTrim ? "wide" : "narrow"][d], difficulty: d, solutions: true, seed };
    case "maze":
      return { kind: "maze", count: n, difficulty: d, solutions: true, seed };
    case "word-scramble":
      return { kind: "word-scramble", puzzles: Array.from({ length: n }, (_, i) => ({ title: `Scramble ${i + 1}`, words: ["ABC"] })), difficulty: d, solutions: true, seed };
    case "crossword": {
      const size = CW_SIZE[`${z.wideTrim ? "wide" : "narrow"}${z.largePrint ? "Large" : ""}`][d];
      return { kind: "crossword", puzzles: Array.from({ length: n }, (_, i) => ({ title: `Crossword ${i + 1}`, entries: [{ answer: "ABC", clue: "x" }] })), size, difficulty: d, solutions: true, seed };
    }
    default:
      return { kind: "cryptogram", phrases: Array.from({ length: n }, () => "A"), difficulty: d, perPage: z.largePrint || !z.wideTrim ? 1 : 2, solutions: true, seed };
  }
}

const withPart = (cfg: GeneratorConfig, part: "puzzles" | "solutions"): GeneratorConfig => ({ ...cfg, part }) as GeneratorConfig;

/** Largest number of puzzles whose pages (puzzles + answer key) fit in `budget`. */
function fitPuzzles(make: (n: number) => GeneratorConfig, budget: number): number {
  const pages = (n: number) => {
    const c = make(n);
    return estimatePageCount(withPart(c, "puzzles")) + estimatePageCount(withPart(c, "solutions"));
  };
  let n = 1;
  while (n < 600 && pages(n + 1) <= budget) n++;
  return n;
}

export function puzzleContent(cfg: GeneratorConfig, theme: string, difficulty: "easy" | "medium" | "hard"): ContentNeed | null {
  if (cfg.kind === "word-search") return { task: "word-lists", theme, count: cfg.puzzles.length, wordsPerPuzzle: cfg.size <= 12 ? 10 : cfg.size <= 15 ? 15 : 18, maxLength: wordSearchMaxLength(cfg.size), difficulty: cfg.difficulty };
  // Longer words are harder to unscramble.
  if (cfg.kind === "word-scramble") return { task: "word-lists", theme, count: cfg.puzzles.length, wordsPerPuzzle: 15, maxLength: { easy: 6, medium: 8, hard: 10 }[cfg.difficulty ?? "medium"], difficulty };
  // Fewer answers in a smaller grid, so they all fit.
  if (cfg.kind === "crossword") return { task: "crossword-clues", theme, count: cfg.puzzles.length, entriesPerPuzzle: Math.min(CW_ENTRIES[cfg.difficulty], cfg.size + 1), maxLength: Math.min(cfg.size - 2, 11), difficulty: cfg.difficulty };
  if (cfg.kind === "cryptogram") return { task: "phrases", theme, count: cfg.phrases.length, maxLength: cfg.perPage === 2 ? 90 : 120, style: "saying" };
  return null;
}

function lowContentConfig(kind: SectionKind, pages: number, bp: BlueprintOutput, label: string): GeneratorConfig {
  // Wider ruling for large-print writers.
  const ruling = bp.largePrint ? 0.375 : 0.3125;
  switch (kind) {
    case "journal-prompts":
      return { kind: "journal-prompts", prompts: [], spacingIn: ruling };
    case "gratitude":
      return { kind: "gratitude", count: pages };
    case "daily-planner":
      return { kind: "daily-planner", count: pages };
    case "weekly-spread":
      return { kind: "weekly-spread", count: pages, startDate: bp.startDate };
    case "monthly-calendar":
      return { kind: "monthly-calendar", count: pages, startDate: bp.startDate };
    case "habit-tracker":
      return { kind: "habit-tracker", count: pages, habits: 15 };
    case "log":
      return { kind: "log", count: pages, title: label, columns: bp.logColumns.length >= 2 ? bp.logColumns : ["Date", "Details", "Notes"], rows: 22 };
    case "dot-grid":
      return { kind: "dot-grid", count: pages, spacingIn: 0.25 };
    case "graph":
      return { kind: "graph", count: pages, spacingIn: 0.25, majorEvery: 4 };
    default:
      return { kind: "lined", count: pages, spacingIn: ruling, header: kind === "free-write" };
  }
}

/**
 * Fixed pages outside the body sections. `dividers` counts the dividers plus
 * one spare page for a blank that may be needed to start one on a right-hand
 * page (sections are sized to odd lengths so this is rare; unused room
 * becomes notes pages at the back). Answer keys get the same spare.
 */
export function frontBackCounts(bp: BlueprintOutput, bookType: BookType): { front: number; back: number; dividers: number; toc: boolean } {
  const n = bp.sections.length;
  const dividers = wantsDividers(bookType, n) ? n + 1 : 0;
  const toc = wantsToc(bookType, n);
  const hasPuzzles = bp.sections.some((s) => PUZZLE_KINDS.includes(s.kind));
  const front = 1 + (isLowContent(bookType) ? 1 : 0) + (bp.howToUse.body.trim() ? 1 : 0) + (toc ? 1 : 0);
  const back = (hasPuzzles ? 2 : 0) + (bp.closing.body.trim() ? 1 : 0);
  return { front, back, dividers, toc };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Puzzle name for divider details ("Sudoku 1–23 · Easy"). */
const PUZZLE_NAME: Partial<Record<GeneratorConfig["kind"], [string, string]>> = {
  sudoku: ["Sudoku", "Sudoku"],
  "word-search": ["Word search", "Word searches"],
  "number-search": ["Number search", "Number searches"],
  maze: ["Maze", "Mazes"],
  "word-scramble": ["Word scramble", "Word scrambles"],
  cryptogram: ["Cryptogram", "Cryptograms"],
  crossword: ["Crossword", "Crosswords"],
};

/** What a section holds, in one line, for its divider. */
export function sectionDetail(cfg: GeneratorConfig): string {
  const n = puzzleCount(cfg);
  const names = PUZZLE_NAME[cfg.kind];
  if (n && names) {
    const start = "startNumber" in cfg ? (cfg.startNumber ?? 1) : 1;
    const range = n === 1 ? `${names[0]} ${start}` : `${names[1]} ${start}–${start + n - 1}`;
    return "difficulty" in cfg && cfg.difficulty ? `${range}  ·  ${capital(cfg.difficulty)}` : range;
  }
  if (cfg.kind === "journal-prompts") return `${cfg.prompts.filter((p) => p.trim()).length} guided pages`;
  const pages = estimatePageCount(cfg);
  return pages > 1 ? `${pages} pages` : "";
}

/** The rules of a puzzle kind, for the "How to play" box on its first divider. */
export function howToPlay(cfg: GeneratorConfig): string {
  switch (cfg.kind) {
    case "sudoku":
      return "Fill every empty square with a number from 1 to 9 so that each row, each column and each 3×3 box holds every number exactly once. Every puzzle has one solution.";
    case "word-search":
    case "number-search": {
      const what = cfg.kind === "word-search" ? "word" : "number";
      const dirs = { easy: "across and down", medium: "across, down and diagonally, and some read backwards", hard: "in any direction, including backwards and diagonally" }[cfg.difficulty];
      return `Find each ${what} from the list in the grid and circle it. They run ${dirs}. Cross each one off the list as you find it.`;
    }
    case "maze":
      return "Start at START and draw the one path through to FINISH without crossing a wall. Dead ends mean it's time to back up and try another way.";
    case "word-scramble":
      return "The letters of each word are mixed up. Rearrange them to spell a word from the theme, and write it on the line.";
    case "crossword":
      return `Read each clue and write the answer in the squares that start at its number, across or down. Answers that cross share a letter, so each one you solve helps with the others.${cfg.difficulty === "easy" ? " The word bank under the clues lists every answer." : ""}`;
    case "cryptogram":
      return "Each saying is written in a code where every letter stands for a different one, the same way throughout the puzzle. Write in the letters you work out; short words and repeated letters are good places to start.";
    default:
      return "";
  }
}

const wantsDividers = (bookType: BookType, sections: number) => sections >= 2 && (bookType === "puzzle" || bookType === "activity" || bookType === "journal");
const wantsToc = (bookType: BookType, sections: number) => sections >= 3 && bookType !== "notebook" && bookType !== "log-book";

/** Allocate the page budget across sections and size each one. */
export function planSections(bp: BlueprintOutput, input: PlanInput): PlannedSection[] {
  const target = clampPageTarget(input.pageTarget);
  const fixed = frontBackCounts(bp, input.bookType);
  const budget = Math.max(bp.sections.length * 2, target - fixed.front - fixed.back - fixed.dividers);
  const trim = findTrim(input.trimId);
  const sizing: Sizing = { largePrint: bp.largePrint, wideTrim: (trim?.widthIn ?? 6) >= 7.5 };

  // Shares → page budgets, honouring per-kind caps and redistributing the excess.
  const totalShare = bp.sections.reduce((n, s) => n + s.sharePercent, 0) || 1;
  const budgets = bp.sections.map((s) => Math.max(2, Math.floor((budget * s.sharePercent) / totalShare)));
  for (let pass = 0; pass < 3; pass++) {
    let excess = 0;
    bp.sections.forEach((s, i) => {
      const cap = KIND_CAP[s.kind];
      if (cap && budgets[i] > cap) {
        excess += budgets[i] - cap;
        budgets[i] = cap;
      }
    });
    const open = bp.sections.map((s, i) => i).filter((i) => !KIND_CAP[bp.sections[i].kind] || budgets[i] < KIND_CAP[bp.sections[i].kind]!);
    if (!excess || !open.length) break;
    open.forEach((i, k) => (budgets[i] += Math.floor(excess / open.length) + (k < excess % open.length ? 1 : 0)));
  }

  // With dividers, an odd-length section keeps the next divider on a right-hand page without a blank page (divider + section = even).
  const odd = fixed.dividers > 0;
  if (odd) bp.sections.forEach((s, i) => {
    if (!PUZZLE_KINDS.includes(s.kind) && budgets[i] % 2 === 0 && budgets[i] > 1) budgets[i]--;
  });

  return bp.sections.map((s, i) => {
    const theme = s.theme.trim() || input.topic;
    if (PUZZLE_KINDS.includes(s.kind)) {
      let n = fitPuzzles((k) => puzzleConfig(s.kind, k, s.difficulty, sizing), budgets[i]);
      while (odd && n > 1 && estimatePageCount(withPart(puzzleConfig(s.kind, n, s.difficulty, sizing), "puzzles")) % 2 === 0) n--;
      const config = puzzleConfig(s.kind, n, s.difficulty, sizing);
      return { label: s.title, subtitle: s.subtitle, kind: s.kind, config, content: puzzleContent(config, theme, capDifficulty(s.difficulty)) };
    }
    const config = lowContentConfig(s.kind, budgets[i], bp, s.title);
    let content: ContentNeed | null = null;
    if (s.kind === "journal-prompts") content = { task: "journal-prompts", theme, count: budgets[i] };
    // One affirmation per page, so no page repeats another.
    if (s.kind === "gratitude") content = { task: "phrases", theme, count: budgets[i], maxLength: 90, style: "affirmation" };
    return { label: s.title, subtitle: s.subtitle, kind: s.kind, config, content };
  });
}

export interface AssembleInput extends PlanInput {
  title: string;
  subtitle: string;
  author: string;
  /** Model run that wrote the blueprint text (how-to, closing, divider lines), if any. */
  blueprintRunId?: string;
}

/**
 * Lay out the whole book from filled sections: front matter, dividers, body,
 * grouped answer keys, notes padding to an even page count, closing page, and
 * a table of contents with real page numbers.
 */
export function assembleBook(bp: BlueprintOutput, sections: PlannedSection[], input: AssembleInput): SectionInput[] {
  const target = clampPageTarget(input.pageTarget);
  const fixed = frontBackCounts(bp, input.bookType);
  const runId = input.blueprintRunId;
  const front: SectionInput[] = [{ label: "Title page", role: "front", config: { kind: "title-page", title: input.title, subtitle: input.subtitle, author: input.author } }];
  if (isLowContent(input.bookType)) front.push({ label: "Belongs to", role: "front", config: { kind: "belongs-to" } });
  if (bp.howToUse.body.trim()) front.push({ label: bp.howToUse.title || "How to use", role: "front", config: { kind: "text-page", title: bp.howToUse.title, body: bp.howToUse.body, aiRunId: runId } });
  const tocIndex = fixed.toc ? front.push({ label: "Contents", role: "front", config: { kind: "table-of-contents", entries: [] } }) - 1 : -1;

  // Body, with puzzle numbering continuing across sections of the same kind.
  const nextNumber = new Map<string, number>();
  const body: { entry: string; items: SectionInput[] }[] = [];
  const keys: SectionInput[] = [];
  const explained = new Set<string>();
  for (const s of sections) {
    let config = s.config;
    const n = puzzleCount(config);
    if (n) {
      const start = nextNumber.get(config.kind) ?? 1;
      nextNumber.set(config.kind, start + n);
      config = { ...config, startNumber: start } as GeneratorConfig;
      keys.push({ label: `${s.label}: answers`, role: "back", config: withPart(config, "solutions") });
      config = withPart(config, "puzzles");
    }
    if (estimatePageCount(config) === 0) continue;
    const items: SectionInput[] = [];
    if (fixed.dividers) {
      // Rules go on the first divider of each puzzle kind only.
      const howTo = explained.has(config.kind) ? "" : howToPlay(config);
      if (howTo) explained.add(config.kind);
      const detail = sectionDetail(config);
      items.push({
        label: `${s.label}: divider`,
        role: "body",
        config: { kind: "section-divider", title: s.label, subtitle: s.subtitle, aiRunId: runId, kicker: `Part ${body.length + 1}`, ...(detail ? { detail } : {}), ...(howTo ? { howTo } : {}) },
      });
    }
    items.push({ label: s.label, role: "body", config });
    body.push({ entry: s.label, items });
  }

  const back: SectionInput[] = [];
  if (keys.length) back.push({ label: "Answer key", role: "back", config: { kind: "section-divider", title: "Answer Key", subtitle: "", detail: "Solutions to every puzzle, in order" } }, ...keys);
  const closing: SectionInput[] = bp.closing.body.trim() ? [{ label: bp.closing.title || "Closing", role: "back", config: { kind: "text-page", title: bp.closing.title, body: bp.closing.body, aiRunId: runId } }] : [];

  const count = (list: SectionInput[]) => list.reduce((t, s) => t + estimatePageCount("config" in s ? s.config : s), 0);
  // Dividers open on a right-hand (odd) page, the way printed books start a part; one that wouldn't gets a blank left-hand page first.
  const all: SectionInput[] = [];
  for (const s of [...front, ...body.flatMap((b) => b.items), ...back]) {
    if ("config" in s && s.config.kind === "section-divider" && count(all) % 2 === 1) s.config = { ...s.config, blankBefore: true };
    all.push(s);
  }
  let total = count(all) + count(closing);
  let pad = Math.max(0, Math.max(target, MIN_PAGES) - total);
  if ((total + pad) % 2) pad++;
  if (pad) {
    all.push({ label: "Notes", role: "back", config: { kind: "lined", count: pad, spacingIn: 0.3125, header: false } });
    total += pad;
  }
  all.push(...closing);

  if (tocIndex >= 0) {
    // Page numbers are 1-based page positions; a section's entry points at its divider (or first page).
    const entries: { title: string; page: number }[] = [];
    let pageNo = 1;
    for (const s of all) {
      const cfg = "config" in s ? s.config : s;
      const label = "config" in s ? s.label : "";
      const isEntry = body.some((b) => b.items[0] === s) || (cfg.kind === "section-divider" && label === "Answer key");
      if (isEntry) entries.push({ title: label === "Answer key" ? "Answer Key" : body.find((b) => b.items[0] === s)!.entry, page: pageNo + (cfg.kind === "section-divider" && cfg.blankBefore ? 1 : 0) });
      pageNo += estimatePageCount(cfg);
    }
    all[tocIndex] = { label: "Contents", role: "front", config: { kind: "table-of-contents", entries } };
  }
  return all;
}

const NOUN: Record<SectionKind, string> = {
  "journal-prompts": "prompt pages",
  "free-write": "lined pages",
  gratitude: "gratitude pages",
  "daily-planner": "daily planner pages",
  "weekly-spread": "weekly planner pages",
  "monthly-calendar": "monthly calendar pages",
  "habit-tracker": "habit tracker pages",
  log: "log pages",
  "dot-grid": "dot grid pages",
  graph: "graph paper pages",
  sudoku: "sudoku puzzles",
  "word-search": "word searches",
  "number-search": "number searches",
  maze: "mazes",
  "word-scramble": "word scrambles",
  cryptogram: "cryptograms",
  crossword: "crosswords",
};

/** One-line description of the planned interior, for the listing and the run log. */
export function describeBook(sections: PlannedSection[]): string {
  return sections
    .map((s) => {
      const n = puzzleCount(s.config) || estimatePageCount(s.config);
      const level = "difficulty" in s.config ? ` (${s.config.difficulty})` : "";
      return `${s.label}: ${n} ${NOUN[s.kind]}${level}`;
    })
    .join("; ");
}
