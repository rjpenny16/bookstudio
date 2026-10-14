import { interiorGeometry, symmetricContentBox, type Box } from "@/lib/kdp/geometry";
import { line, path, pattern, rect, text } from "@/lib/schema/elements";
import type { ArtifactProvenance, Asset, Element, Page, PrintSpec } from "@/lib/schema/project";
import { measureLines, textWidth } from "@/lib/render/metrics";
import { approxMeasure, lineAdvance, textBlockHeight, wrapText } from "@/lib/render/textLayout";
import { inToPt, newId } from "@/lib/util/ids";
import { addDays, addMonths, monthGrid, monthLabel, parseStart, shortDate, startOfWeek, WEEKDAYS, WEEKDAYS_SHORT } from "./calendar";
import { generateCrossword, normalizeAnswer, type Crossword, type CrosswordDifficulty } from "./crossword";
import { generateCryptogram, type Cryptogram } from "./cryptogram";
import { generateMaze, mazeSolutionPath, mazeWallsPath, type Maze } from "./maze";
import { createRng, randInt, randomSeed } from "./rng";
import { scrambleWords, secretOrder } from "./scramble";
import { CLASSIC_STYLE, LARGE_PRINT_MIN_PT, ornament, type InteriorStyle } from "./style";
import { generateSudoku, type Sudoku, type SudokuDifficulty } from "./sudoku";
import { DIGITS, generateWordSearch, normalizeWord, type WordSearch, type WordSearchDifficulty } from "./wordsearch";

/**
 * Which part of a puzzle section to emit. "all" (default) prints the puzzles
 * followed by their answer key. Books that group answer keys at the back emit
 * the same config twice: once as "puzzles", once as "solutions". The seed makes
 * both passes produce identical puzzles.
 */
export type PuzzlePart = "all" | "puzzles" | "solutions";

interface PuzzleCommon {
  solutions: boolean;
  seed: number;
  part?: PuzzlePart;
  /** Number of the first puzzle, so numbering continues across sections. */
  startNumber?: number;
  /** The printed number of each puzzle, in place of startNumber + i (a mystery numbers its puzzles by clue). */
  numbers?: number[];
}

/** The number printed on puzzle `i` of a config. */
const numberOf = (cfg: PuzzleCommon, i: number) => cfg.numbers?.[i] ?? (cfg.startNumber ?? 1) + i;

export type GeneratorConfig =
  | { kind: "blank"; count: number }
  | { kind: "lined"; count: number; spacingIn: number; header: boolean }
  | { kind: "dot-grid"; count: number; spacingIn: number }
  | { kind: "graph"; count: number; spacingIn: number; majorEvery: number }
  | { kind: "handwriting"; count: number; rowHeightIn: number }
  | { kind: "music"; count: number; staves: number }
  | { kind: "journal-prompts"; prompts: string[]; spacingIn: number; aiRunId?: string }
  | { kind: "gratitude"; count: number; affirmations?: string[]; aiRunId?: string }
  | { kind: "daily-planner"; count: number }
  | { kind: "habit-tracker"; count: number; habits: number }
  | { kind: "log"; count: number; title: string; columns: string[]; rows: number }
  | { kind: "title-page"; title: string; subtitle: string; author: string }
  | { kind: "belongs-to" }
  | { kind: "text-page"; title: string; body: string; aiRunId?: string }
  /** Prose that flows over `pages` pages (a mystery's chapters), set as large as it fits. */
  | { kind: "story"; title: string; kicker?: string; body: string; pages: number; aiRunId?: string }
  | {
      kind: "section-divider";
      title: string;
      subtitle: string;
      aiRunId?: string;
      /** Small capitals above the title ("PART 2"), optional. */
      kicker?: string;
      /** What the section holds ("Puzzles 1-23 · Easy"), optional. */
      detail?: string;
      /** How to play, printed in a box under the title, optional. */
      howTo?: string;
      /** An unnumbered blank page first, so the divider opens on a right-hand page. */
      blankBefore?: boolean;
    }
  | { kind: "table-of-contents"; entries: { title: string; page: number }[] }
  | { kind: "monthly-calendar"; count: number; startDate: string }
  | { kind: "weekly-spread"; count: number; startDate: string }
  | ({ kind: "sudoku"; count: number; difficulty: SudokuDifficulty; perPage: 1 | 2 | 4; /** Solved grids per answer-key page (default 6; large print uses 4). */ keysPerPage?: 4 | 6 } & PuzzleCommon)
  | ({
      kind: "word-search";
      /** `message`: a clue hidden in the leftover letters (mystery books). */
      puzzles: { title: string; words: string[]; message?: string }[];
      size: number;
      difficulty: WordSearchDifficulty;
      aiRunId?: string;
    } & PuzzleCommon)
  | ({ kind: "number-search"; count: number; size: number; difficulty: WordSearchDifficulty } & PuzzleCommon)
  | ({ kind: "maze"; count: number; difficulty: "easy" | "medium" | "hard" } & PuzzleCommon)
  /** `secret`: a word spelled by one shaded letter of each answer, top to bottom (mystery books). */
  | ({ kind: "word-scramble"; puzzles: { title: string; words: string[]; secret?: string }[]; difficulty?: "easy" | "medium" | "hard"; aiRunId?: string } & PuzzleCommon)
  | ({
      kind: "crossword";
      /** `key`: the answer that is a mystery's clue, starred and shaded. */
      puzzles: { title: string; entries: { answer: string; clue: string }[]; key?: string }[];
      /** Most squares across or down. */
      size: number;
      difficulty: CrosswordDifficulty;
      aiRunId?: string;
    } & PuzzleCommon)
  | ({ kind: "cryptogram"; phrases: string[]; difficulty: "easy" | "medium" | "hard"; perPage: 1 | 2; aiRunId?: string } & PuzzleCommon)
  | { kind: "coloring"; assetIds: string[]; blankBacks: boolean };

export type GeneratorKind = GeneratorConfig["kind"];

export interface GeneratorInfo {
  kind: GeneratorKind;
  label: string;
  group: "Low-content" | "Puzzles" | "Front matter" | "Art";
  description: string;
  defaults: () => GeneratorConfig;
}

export const GENERATORS: GeneratorInfo[] = [
  { kind: "lined", label: "Lined pages", group: "Low-content", description: "College or wide ruled writing pages", defaults: () => ({ kind: "lined", count: 100, spacingIn: 0.3125, header: true }) },
  { kind: "dot-grid", label: "Dot grid", group: "Low-content", description: "Bullet-journal dot grid", defaults: () => ({ kind: "dot-grid", count: 100, spacingIn: 0.25 }) },
  { kind: "graph", label: "Graph paper", group: "Low-content", description: "Square grid with optional major lines", defaults: () => ({ kind: "graph", count: 100, spacingIn: 0.25, majorEvery: 4 }) },
  { kind: "handwriting", label: "Handwriting practice", group: "Low-content", description: "Three-line handwriting rows with dashed midline", defaults: () => ({ kind: "handwriting", count: 50, rowHeightIn: 0.75 }) },
  { kind: "music", label: "Music staff", group: "Low-content", description: "Blank manuscript paper", defaults: () => ({ kind: "music", count: 50, staves: 10 }) },
  { kind: "journal-prompts", label: "Prompt journal", group: "Low-content", description: "One writing prompt per page with ruled lines", defaults: () => ({ kind: "journal-prompts", prompts: ["What made you smile today?", "Describe a place where you feel calm.", "What is one thing you want to remember about this week?"], spacingIn: 0.3125 }) },
  { kind: "gratitude", label: "Gratitude journal", group: "Low-content", description: "Daily gratitude, highlight and affirmation", defaults: () => ({ kind: "gratitude", count: 90 }) },
  { kind: "daily-planner", label: "Daily planner", group: "Low-content", description: "Hourly schedule, priorities, to-dos and notes", defaults: () => ({ kind: "daily-planner", count: 90 }) },
  { kind: "habit-tracker", label: "Habit tracker", group: "Low-content", description: "Monthly habit grid", defaults: () => ({ kind: "habit-tracker", count: 12, habits: 15 }) },
  { kind: "log", label: "Log book", group: "Low-content", description: "Table with your own columns", defaults: () => ({ kind: "log", count: 100, title: "Log", columns: ["Date", "Description", "Amount", "Notes"], rows: 25 }) },
  { kind: "monthly-calendar", label: "Monthly calendar", group: "Low-content", description: "Month grid, dated or undated", defaults: () => ({ kind: "monthly-calendar", count: 12, startDate: "" }) },
  { kind: "weekly-spread", label: "Weekly planner", group: "Low-content", description: "One week per page with a notes box", defaults: () => ({ kind: "weekly-spread", count: 52, startDate: "" }) },
  { kind: "sudoku", label: "Sudoku", group: "Puzzles", description: "Unique-solution sudoku with answer key", defaults: () => ({ kind: "sudoku", count: 100, difficulty: "medium", perPage: 2, solutions: true, seed: randomSeed() }) },
  { kind: "word-search", label: "Word search", group: "Puzzles", description: "Themed word searches with answer key", defaults: () => ({ kind: "word-search", puzzles: [{ title: "Fruits", words: ["apple", "banana", "cherry", "grape", "lemon", "mango", "orange", "peach", "pear", "plum", "kiwi", "melon"] }], size: 15, difficulty: "medium", solutions: true, seed: randomSeed() }) },
  { kind: "maze", label: "Mazes", group: "Puzzles", description: "Perfect mazes with solutions", defaults: () => ({ kind: "maze", count: 50, difficulty: "medium", solutions: true, seed: randomSeed() }) },
  { kind: "number-search", label: "Number search", group: "Puzzles", description: "Find number sequences in a digit grid", defaults: () => ({ kind: "number-search", count: 30, size: 14, difficulty: "medium", solutions: true, seed: randomSeed() }) },
  { kind: "word-scramble", label: "Word scramble", group: "Puzzles", description: "Unscramble themed words, with answer key", defaults: () => ({ kind: "word-scramble", puzzles: [{ title: "Fruits", words: ["apple", "banana", "cherry", "grape", "lemon", "mango", "orange", "peach", "plum", "melon", "papaya", "guava"] }], solutions: true, seed: randomSeed() }) },
  {
    kind: "crossword",
    label: "Crossword",
    group: "Puzzles",
    description: "Themed criss-cross crosswords with clues and answer key",
    defaults: () => ({
      kind: "crossword",
      puzzles: [
        {
          title: "Fruits",
          entries: [
            { answer: "apple", clue: "Fruit that keeps the doctor away" },
            { answer: "banana", clue: "Long yellow fruit you peel" },
            { answer: "cherry", clue: "Small red fruit with a stone, often on a sundae" },
            { answer: "grape", clue: "Grows in bunches on a vine" },
            { answer: "lemon", clue: "Sour yellow citrus fruit" },
            { answer: "mango", clue: "Tropical fruit with orange flesh and a big flat stone" },
            { answer: "peach", clue: "Fuzzy-skinned summer fruit" },
            { answer: "melon", clue: "Large fruit such as a cantaloupe" },
            { answer: "plum", clue: "Purple fruit that dries into a prune" },
            { answer: "orange", clue: "Citrus fruit and a color" },
          ],
        },
      ],
      size: 13,
      difficulty: "easy",
      solutions: true,
      seed: randomSeed(),
    }),
  },
  { kind: "cryptogram", label: "Cryptogram", group: "Puzzles", description: "Decode letter-substitution sayings", defaults: () => ({ kind: "cryptogram", phrases: ["Slow and steady wins the race", "A journey of a thousand miles begins with a single step"], difficulty: "medium", perPage: 2, solutions: true, seed: randomSeed() }) },
  { kind: "coloring", label: "Coloring pages", group: "Art", description: "Your line art, one per page, blank backs", defaults: () => ({ kind: "coloring", assetIds: [], blankBacks: true }) },
  { kind: "title-page", label: "Title page", group: "Front matter", description: "Title, subtitle and author", defaults: () => ({ kind: "title-page", title: "Title", subtitle: "", author: "" }) },
  { kind: "belongs-to", label: "This book belongs to", group: "Front matter", description: "Ownership page", defaults: () => ({ kind: "belongs-to" }) },
  { kind: "text-page", label: "Text page", group: "Front matter", description: "Heading and paragraphs: how to use, introduction, thank-you", defaults: () => ({ kind: "text-page", title: "How to Use This Book", body: "Write a short introduction here." }) },
  { kind: "story", label: "Story chapter", group: "Front matter", description: "A chapter of prose that runs over as many pages as you set", defaults: () => ({ kind: "story", title: "Chapter One", kicker: "Chapter 1", body: "Write the chapter here.\n\nA blank line starts a new paragraph.", pages: 2 }) },
  { kind: "section-divider", label: "Section divider", group: "Front matter", description: "Full-page section title", defaults: () => ({ kind: "section-divider", title: "Part One", subtitle: "" }) },
  { kind: "table-of-contents", label: "Table of contents", group: "Front matter", description: "Section titles with page numbers", defaults: () => ({ kind: "table-of-contents", entries: [{ title: "Section", page: 5 }] }) },
  { kind: "blank", label: "Blank pages", group: "Front matter", description: "Empty pages", defaults: () => ({ kind: "blank", count: 2 }) },
];

export function generatorInfo(kind: GeneratorKind): GeneratorInfo {
  return GENERATORS.find((g) => g.kind === kind)!;
}

const INK = "#111111";
const RULE = "#8c8c8c";
const LIGHT = "#bdbdbd";
const SANS = "Inter";

interface Ctx {
  box: Box;
  style: InteriorStyle;
  trimW: number;
  trimH: number;
  prov: ArtifactProvenance;
  assets: Map<string, Asset>;
}

function tag<T extends Element>(ctx: Ctx, el: T, prov?: ArtifactProvenance): T {
  return { ...el, provenance: prov ?? ctx.prov };
}

function page(ctx: Ctx, kind: string, elements: Element[], extra: Partial<Page> = {}): Page {
  return { id: newId("pg"), elements: elements.map((e) => (e.provenance ? e : tag(ctx, e))), generator: { kind }, ...extra };
}

/** Largest size up to `max` at which `s` fits `width` in at most `lines` lines (never below `min`). */
function fitSize(s: string, family: string, bold: boolean, max: number, min: number, width: number, lines: number): number {
  for (let size = max; size > min; size -= 1) if (measureLines(s, family, bold, size, width).length <= lines) return size;
  return min;
}

/** A centered page heading in the style's heading face; returns the element and the height it takes. */
function headingBlock(ctx: Ctx, s: string, y: number, size = ctx.style.sizes.pageTitle): { el: Element; height: number } {
  const { family, bold } = ctx.style.heading;
  const fs = fitSize(s, family, bold, size, Math.min(size, 12), ctx.box.width, 2);
  const n = measureLines(s, family, bold, fs, ctx.box.width).length;
  const height = textBlockHeight(n, fs, 1.1);
  return { el: text({ x: ctx.box.x, y, width: ctx.box.width, text: s, fontSize: fs, bold, fontFamily: family, align: "center", color: INK, height, lineHeight: 1.1 }), height };
}

function heading(ctx: Ctx, s: string, y: number, size = ctx.style.sizes.pageTitle): Element {
  return headingBlock(ctx, s, y, size).el;
}

function labelLine(ctx: Ctx, label: string, x: number, y: number, width: number, size = ctx.style.sizes.small): Element[] {
  const family = ctx.style.label;
  const w = textWidth(label, family, false, size) + 6;
  return [
    text({ x, y: y - size * 1.1, width: Math.max(w, Math.min(width, w + 20)), text: label, fontSize: size, fontFamily: family, color: INK, height: size * 1.13 }),
    line({ x: x + w, y, width: width - w, height: 0, stroke: RULE, strokeWidth: 0.6 }),
  ];
}

/** The style's ornament, `width` wide and centered on `cx`, top at `y`. Returns the elements and their height. */
function ornamentElements(ctx: Ctx, cx: number, y: number, width: number, color = INK): { els: Element[]; height: number } {
  const parts = ornament(ctx.style.ornament);
  const sc = width / parts[0].w;
  const els = parts.map((o) =>
    path({ x: cx - width / 2, y, width: o.w * sc, height: o.h * sc, viewBoxW: o.w, viewBoxH: o.h, d: o.d, fill: o.fill ? color : null, stroke: o.fill ? null : color, strokeWidth: o.strokeWidth * sc, name: "Ornament" }),
  );
  return { els, height: parts[0].h * sc };
}

function cellText(x: number, y: number, size: number, s: string, fontSize: number, opts: { bold?: boolean; color?: string; family?: string } = {}): Element {
  return text({
    x,
    y: y + (size - fontSize * 1.13) / 2 + fontSize * 0.04,
    width: size,
    height: fontSize * 1.13,
    text: s,
    fontSize,
    bold: opts.bold ?? false,
    align: "center",
    color: opts.color ?? INK,
    fontFamily: opts.family ?? SANS,
    lineHeight: 1,
  });
}

/* ------------------------------ low-content ------------------------------ */

function ruledPages(ctx: Ctx, count: number, spacing: number, header: boolean): Page[] {
  return Array.from({ length: count }, () => {
    const els: Element[] = [];
    let top = ctx.box.y;
    if (header) {
      const size = ctx.style.sizes.small;
      els.push(...labelLine(ctx, "Date:", ctx.box.x, top + size * 1.4, ctx.box.width * 0.45));
      top += size * 2.8;
    }
    els.push(pattern({ x: ctx.box.x, y: top, width: ctx.box.width, height: ctx.box.y + ctx.box.height - top, pattern: { kind: "lines", spacing }, stroke: RULE, strokeWidth: 0.5 }));
    return page(ctx, "lined", els);
  });
}

function journalPromptPages(ctx: Ctx, prompts: string[], spacing: number, aiRunId?: string): Page[] {
  const promptProv: ArtifactProvenance | undefined = aiRunId ? { origin: "ai-generated", runId: aiRunId } : undefined;
  const { body } = ctx.style;
  const size = ctx.style.sizes.body + 2;
  return prompts.map((prompt) => {
    // Measured, so the ruled lines start a steady gap under the prompt however many lines it takes.
    const h = textBlockHeight(measureLines(prompt, body, true, size, ctx.box.width).length, size, 1.25);
    const promptEl = text({ x: ctx.box.x, y: ctx.box.y, width: ctx.box.width, height: h, text: prompt, fontSize: size, fontFamily: body, bold: true, color: INK, align: "left", lineHeight: 1.25, name: "Prompt" });
    const top = ctx.box.y + h + Math.max(14, spacing * 0.8);
    return page(ctx, "journal-prompts", [
      promptProv ? tag(ctx, promptEl, promptProv) : promptEl,
      pattern({ x: ctx.box.x, y: top, width: ctx.box.width, height: ctx.box.y + ctx.box.height - top, pattern: { kind: "lines", spacing }, stroke: RULE, strokeWidth: 0.5 }),
    ]);
  });
}

function lineBlock(ctx: Ctx, top: number, count: number, spacing: number, x = ctx.box.x, width = ctx.box.width): Element {
  return pattern({ x, y: top, width, height: count * spacing, pattern: { kind: "lines", spacing }, stroke: RULE, strokeWidth: 0.5 });
}

/** A bold field label in the style's label face ("Today's highlight:"). */
function fieldLabel(ctx: Ctx, s: string, x: number, y: number, width: number, size = ctx.style.sizes.small + 1): Element {
  return text({ x, y, width, text: s, fontSize: size, bold: true, fontFamily: ctx.style.label, color: INK, height: size * 1.13 });
}

function gratitudePages(ctx: Ctx, count: number, affirmations: string[] = [], aiRunId?: string): Page[] {
  const st = ctx.style;
  const sp = inToPt(st.largePrint ? 0.4 : 0.3125);
  const labelSize = st.sizes.small + 1;
  const lines = affirmations.map((a) => a.trim()).filter(Boolean);
  const affProv: ArtifactProvenance | undefined = aiRunId ? { origin: "ai-generated", runId: aiRunId } : undefined;
  return Array.from({ length: count }, (_, i) => {
    const b = ctx.box;
    const head = headingBlock(ctx, "Today I Am Grateful", b.y);
    const els: Element[] = [head.el];
    let y = b.y + head.height + labelSize * 2.2;
    els.push(...labelLine(ctx, "Date:", b.x, y, b.width * 0.5));
    y += labelSize * 1.4;
    const affirmation = lines.length ? lines[i % lines.length] : null;
    if (affirmation) {
      const size = st.sizes.body;
      const quoted = `“${affirmation}”`;
      const h = textBlockHeight(measureLines(quoted, st.body, false, size, b.width * 0.9).length, size, 1.3);
      const el = text({ x: b.x + b.width * 0.05, y, width: b.width * 0.9, height: h, text: quoted, fontSize: size, fontFamily: st.body, color: "#333333", align: "center", lineHeight: 1.3, name: "Affirmation" });
      els.push(affProv ? tag(ctx, el, affProv) : el);
      y += h + 14;
    }
    const section = (title: string, n: number, numbered = false) => {
      els.push(fieldLabel(ctx, title, b.x, y, b.width, labelSize));
      y += labelSize * 1.45;
      const numW = numbered ? textWidth("3.", st.label, false, labelSize) + 6 : 0;
      for (let k = 0; numbered && k < n; k++) els.push(text({ x: b.x, y: y + k * sp + sp - labelSize * 1.1, width: numW, text: `${k + 1}.`, fontSize: labelSize - 1, fontFamily: st.label, color: INK, height: labelSize * 1.13 }));
      els.push(lineBlock(ctx, y, n, sp, b.x + numW, b.width - numW));
      y += n * sp + 14;
    };
    section("Three things I'm grateful for:", 3, true);
    section("Today's highlight:", st.largePrint ? 2 : 3);
    if (!affirmation) section("Today's affirmation:", 2);
    section("How could today have been better?", 2);
    const remaining = Math.floor((b.y + b.height - y - labelSize * 1.45) / sp);
    if (remaining > 0) section("Notes:", remaining);
    return page(ctx, "gratitude", els);
  });
}

function checkbox(x: number, y: number, s = 9): Element {
  return rect({ x, y, width: s, height: s, fill: null, stroke: INK, strokeWidth: 0.6 });
}

function plannerPages(ctx: Ctx, count: number): Page[] {
  const st = ctx.style;
  const labelSize = st.sizes.small + 1;
  return Array.from({ length: count }, () => {
    const b = ctx.box;
    const head = headingBlock(ctx, "Daily Planner", b.y);
    const els: Element[] = [head.el];
    let y = b.y + head.height + labelSize * 2;
    els.push(...labelLine(ctx, "Date:", b.x, y, b.width * 0.5));
    y += labelSize * 1.2;
    const colGap = 14;
    const leftW = (b.width - colGap) * 0.55;
    const rightX = b.x + leftW + colGap;
    const rightW = b.width - leftW - colGap;
    const bottom = b.y + b.height;
    // Schedule column
    els.push(fieldLabel(ctx, "Schedule", b.x, y, leftW, labelSize));
    const hours = ["6 AM", "7", "8", "9", "10", "11", "12 PM", "1", "2", "3", "4", "5", "6", "7", "8", "9 PM"];
    const hourSize = Math.max(8, st.sizes.small - 2);
    const hourW = textWidth("12 PM", st.label, false, hourSize) + 6;
    const rowH = (bottom - (y + labelSize * 1.5)) / hours.length;
    hours.forEach((h, i) => {
      const ry = y + labelSize * 1.5 + i * rowH;
      els.push(text({ x: b.x, y: ry + rowH - hourSize * 1.35, width: hourW, text: h, fontSize: hourSize, fontFamily: st.label, color: "#444444", height: hourSize * 1.13 }));
      els.push(line({ x: b.x + hourW, y: ry + rowH, width: leftW - hourW, height: 0, stroke: RULE, strokeWidth: 0.5 }));
    });
    // Right column
    let ry = y;
    const sp = inToPt(st.largePrint ? 0.36 : 0.3);
    const box = Math.min(11, sp * 0.4);
    const checklist = (title: string, n: number) => {
      els.push(fieldLabel(ctx, title, rightX, ry, rightW, labelSize));
      ry += labelSize * 1.5;
      for (let i = 0; i < n; i++) {
        els.push(checkbox(rightX, ry + sp - box - 2, box), line({ x: rightX + box + 5, y: ry + sp, width: rightW - box - 5, height: 0, stroke: RULE, strokeWidth: 0.5 }));
        ry += sp;
      }
      ry += 14;
    };
    checklist("Top Priorities", 3);
    checklist("To Do", st.largePrint ? 6 : 8);
    els.push(fieldLabel(ctx, "Notes", rightX, ry, rightW, labelSize));
    ry += labelSize * 1.4;
    const noteLines = Math.floor((bottom - ry) / sp);
    if (noteLines > 0) els.push(lineBlock(ctx, ry, noteLines, sp, rightX, rightW));
    return page(ctx, "daily-planner", els);
  });
}

function habitPages(ctx: Ctx, count: number, habits: number): Page[] {
  const st = ctx.style;
  return Array.from({ length: count }, () => {
    const b = ctx.box;
    const head = headingBlock(ctx, "Habit Tracker", b.y);
    const els: Element[] = [head.el];
    let y = b.y + head.height + st.sizes.small * 2;
    els.push(...labelLine(ctx, "Month:", b.x, y, b.width * 0.5));
    y += st.sizes.small * 1.2;
    const nameW = Math.min(b.width * 0.28, 120);
    const cell = (b.width - nameW) / 31;
    const rowH = Math.min(cell * 1.6, (b.y + b.height - y - cell) / habits);
    const gridH = cell + rowH * habits;
    for (let d = 0; d < 31; d++) els.push(cellText(b.x + nameW + d * cell, y, cell, String(d + 1), Math.min(8, cell * 0.68), { family: st.label }));
    els.push(rect({ x: b.x, y, width: b.width, height: gridH, fill: null, stroke: INK, strokeWidth: 0.8 }));
    els.push(line({ x: b.x, y: y + cell, width: b.width, height: 0, stroke: INK, strokeWidth: 0.8 }));
    for (let h = 1; h < habits; h++) els.push(line({ x: b.x, y: y + cell + h * rowH, width: b.width, height: 0, stroke: LIGHT, strokeWidth: 0.5 }));
    els.push(line({ x: b.x + nameW, y, width: 0, height: gridH, stroke: INK, strokeWidth: 0.8 }));
    for (let d = 1; d < 31; d++) els.push(line({ x: b.x + nameW + d * cell, y, width: 0, height: gridH, stroke: LIGHT, strokeWidth: 0.4 }));
    els.push(text({ x: b.x + 4, y: y + (cell - 9) / 2, width: nameW - 8, text: "Habit", fontSize: 8, bold: true, fontFamily: st.label, height: 9 }));
    return page(ctx, "habit-tracker", els);
  });
}

function logPages(ctx: Ctx, count: number, title: string, columns: string[], rows: number): Page[] {
  const cols = columns.length ? columns : ["Entry"];
  const st = ctx.style;
  return Array.from({ length: count }, () => {
    const b = ctx.box;
    const head = headingBlock(ctx, title, b.y);
    const els: Element[] = [head.el];
    const top = b.y + head.height + 10;
    const colW = b.width / cols.length;
    // Column names at the largest size (up to the small text size) where the longest fits its column.
    const size = Math.min(...cols.map((c) => fitSize(c, st.label, true, st.sizes.small, 7, colW - 6, 1)));
    const headerH = size * 1.13 + 8;
    const rowH = (b.y + b.height - top - headerH) / rows;
    els.push(rect({ x: b.x, y: top, width: b.width, height: headerH, fill: "#e6e6e6", stroke: INK, strokeWidth: 0.8 }));
    cols.forEach((c, i) => els.push(text({ x: b.x + i * colW + 3, y: top + 4, width: colW - 6, text: c, fontSize: size, bold: true, fontFamily: st.label, align: "center", height: size * 1.13 })));
    els.push(rect({ x: b.x, y: top, width: b.width, height: headerH + rowH * rows, fill: null, stroke: INK, strokeWidth: 0.8 }));
    for (let r = 1; r <= rows - 1; r++) els.push(line({ x: b.x, y: top + headerH + r * rowH, width: b.width, height: 0, stroke: RULE, strokeWidth: 0.5 }));
    for (let i = 1; i < cols.length; i++) els.push(line({ x: b.x + i * colW, y: top, width: 0, height: headerH + rowH * rows, stroke: RULE, strokeWidth: 0.5 }));
    return page(ctx, "log", els);
  });
}

/* ------------------------------ front matter ----------------------------- */

function titlePage(ctx: Ctx, title: string, subtitle: string, author: string): Page {
  const b = ctx.box;
  const st = ctx.style;
  const { family, bold } = st.heading;
  // The title is set as large as fits in three lines, with the ornament above and the subtitle under a short rule.
  const size = fitSize(title, family, bold, st.sizes.title, 16, b.width * 0.92, 3);
  const titleH = textBlockHeight(measureLines(title, family, bold, size, b.width * 0.92).length, size, 1.12);
  const subSize = Math.max(st.sizes.small, Math.round(st.sizes.body * 1.1));
  const subH = subtitle ? textBlockHeight(measureLines(subtitle, st.body, false, subSize, b.width * 0.8).length, subSize, 1.3) : 0;
  const orn = Math.min(150, b.width * 0.45);
  const ornH = (orn * 24) / 120;
  const blockH = ornH + 24 + titleH + (subtitle ? 22 + subH : 0);
  let y = b.y + Math.max(0, b.height * 0.4 - blockH / 2);
  const o = ornamentElements(ctx, b.x + b.width / 2, y, orn);
  const els: Element[] = [...o.els];
  y += o.height + 24;
  els.push(text({ x: b.x + b.width * 0.04, y, width: b.width * 0.92, height: titleH, text: title, fontSize: size, bold, fontFamily: family, align: "center", lineHeight: 1.12, name: "Title" }));
  y += titleH;
  if (subtitle) {
    els.push(line({ x: b.x + b.width / 2 - 24, y: y + 11, width: 48, height: 0, stroke: INK, strokeWidth: 0.8 }));
    y += 22;
    els.push(text({ x: b.x + b.width * 0.1, y, width: b.width * 0.8, height: subH, text: subtitle, fontSize: subSize, fontFamily: st.body, align: "center", color: "#333333", lineHeight: 1.3, name: "Subtitle" }));
  }
  if (author) {
    const aSize = Math.max(st.sizes.small, 12);
    els.push(text({ x: b.x, y: b.y + b.height * 0.82, width: b.width, height: aSize * 1.13, text: author, fontSize: aSize, fontFamily: st.label, align: "center", letterSpacing: 0.08, name: "Author" }));
  }
  return page(ctx, "title-page", els, { hideNumber: true, label: "Title page" });
}

function belongsToPage(ctx: Ctx): Page {
  const b = ctx.box;
  const y = b.y + b.height * 0.36;
  const o = ornamentElements(ctx, b.x + b.width / 2, y, Math.min(120, b.width * 0.4));
  const head = headingBlock(ctx, "This Book Belongs To", y + o.height + 18, Math.round(ctx.style.sizes.pageTitle * 1.2));
  const lineY = y + o.height + 18 + head.height + 64;
  return page(
    ctx,
    "belongs-to",
    [...o.els, head.el, line({ x: b.x + b.width * 0.15, y: lineY, width: b.width * 0.7, height: 0, stroke: INK, strokeWidth: 0.8 })],
    { hideNumber: true, label: "Belongs to" },
  );
}

/** Largest font size (max..min) at which `body` fits in `height`; returns the size and wrapped height. */
function fitBody(body: string, family: string, width: number, height: number, max: number, min: number, lineHeight: number): { size: number; height: number } {
  // Paragraph breaks are kept by measuring each paragraph separately.
  const measure = (size: number) => body.split("\n").reduce((n, para) => n + Math.max(1, para.trim() ? measureLines(para, family, false, size, width).length : 1), 0);
  for (let size = max; size >= min; size -= 0.5) {
    const h = textBlockHeight(measure(size), size, lineHeight);
    if (h <= height) return { size, height: h };
  }
  return { size: min, height: Math.min(height, textBlockHeight(wrapText(body, width, approxMeasure(min)).length, min, lineHeight)) };
}

function textPage(ctx: Ctx, title: string, body: string, aiRunId?: string): Page {
  const b = ctx.box;
  const st = ctx.style;
  const els: Element[] = [];
  let top = b.y;
  if (title.trim()) {
    const head = headingBlock(ctx, title, top, Math.round(st.sizes.pageTitle * 1.1));
    els.push(head.el);
    const o = ornamentElements(ctx, b.x + b.width / 2, top + head.height + 10, 70);
    els.push(...o.els);
    top += head.height + 10 + o.height + 20;
  }
  const clean = body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (clean) {
    const lh = 1.45;
    const fit = fitBody(clean, st.body, b.width, b.y + b.height - top, st.sizes.body, st.largePrint ? 13 : 9, lh);
    const el = text({ x: b.x, y: top, width: b.width, height: fit.height, text: clean, fontSize: fit.size, fontFamily: st.body, color: INK, align: "left", lineHeight: lh, name: "Body" });
    els.push(aiRunId ? tag(ctx, el, { origin: "ai-generated", runId: aiRunId }) : el);
  }
  return page(ctx, "text-page", els, { label: title.slice(0, 40) || "Text page" });
}

/** Smallest story type: a chapter shrinks to fit its pages, but never below this. */
const storyMin = (st: InteriorStyle) => (st.largePrint ? LARGE_PRINT_MIN_PT : st.genre === "kids" ? 12 : 10);
const STORY_LEADING = 1.42;

/**
 * A chapter set at `size`: the lines of each page (a blank line between
 * paragraphs, none at the top of a page) and the room the heading takes on
 * the first one.
 */
function layoutStory(ctx: Ctx, title: string, kicker: string, body: string, size: number): { pages: string[][]; headH: number } {
  const b = ctx.box;
  const st = ctx.style;
  let headH = 0;
  if (kicker.trim()) headH += Math.max(st.sizes.small, 11) * 1.13 + 10;
  if (title.trim()) headH += headingBlock(ctx, title, b.y, Math.round(st.sizes.pageTitle * 1.1)).height + 10 + ornamentElements(ctx, 0, 0, 70).height + 18;
  // Lines that fit a height, measured the way text is drawn (the first line takes the font's height, the rest its leading).
  const fit = (h: number) => Math.max(0, Math.floor((h - textBlockHeight(1, size, STORY_LEADING)) / lineAdvance(size, STORY_LEADING)) + 1);
  const paras = body.replace(/\r/g, "").split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);
  const pages: string[][] = [[]];
  let room = fit(b.height - headH);
  for (const para of paras) {
    const lines = measureLines(para, st.body, false, size, b.width);
    // A blank line between paragraphs, unless the page has just begun.
    if (pages[pages.length - 1].length) lines.unshift("");
    for (const ln of lines) {
      if (room <= 0) {
        pages.push([]);
        room = fit(b.height);
        if (!ln) continue;
      }
      pages[pages.length - 1].push(ln);
      room--;
    }
  }
  return { pages, headH };
}

function storyPages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "story" }>): Page[] {
  const b = ctx.box;
  const st = ctx.style;
  const count = Math.max(1, cfg.pages);
  const kicker = cfg.kicker ?? "";
  // The largest size (half points) at which the chapter fits its pages; at the smallest size, overflow stays on the last page.
  let size = st.sizes.body;
  let lay = layoutStory(ctx, cfg.title, kicker, cfg.body, size);
  while (lay.pages.length > count && size > storyMin(st)) {
    size -= 0.5;
    lay = layoutStory(ctx, cfg.title, kicker, cfg.body, size);
  }
  if (lay.pages.length > count) lay.pages.splice(count - 1, lay.pages.length, lay.pages.slice(count - 1).flat());
  const ai = (el: Element) => (cfg.aiRunId ? tag(ctx, el, { origin: "ai-generated", runId: cfg.aiRunId }) : el);
  return Array.from({ length: count }, (_, n) => {
    const els: Element[] = [];
    let top = b.y;
    if (n === 0) {
      if (kicker.trim()) {
        const ks = Math.max(st.sizes.small, 11);
        els.push(text({ x: b.x, y: top, width: b.width, height: ks * 1.13, text: kicker.toUpperCase(), fontSize: ks, fontFamily: st.label, bold: true, color: "#555555", align: "center", letterSpacing: 0.2, name: "Chapter number" }));
        top += ks * 1.13 + 10;
      }
      if (cfg.title.trim()) {
        const head = headingBlock(ctx, cfg.title, top, Math.round(st.sizes.pageTitle * 1.1));
        els.push(ai(head.el));
        const o = ornamentElements(ctx, b.x + b.width / 2, top + head.height + 10, 70);
        els.push(...o.els);
      }
      top = b.y + lay.headH;
    }
    const lines = lay.pages[n] ?? [];
    if (lines.length)
      els.push(ai(text({ x: b.x, y: top, width: b.width, height: textBlockHeight(lines.length, size, STORY_LEADING), text: lines.join("\n"), fontSize: size, fontFamily: st.body, color: INK, align: "left", lineHeight: STORY_LEADING, name: "Story" })));
    return page(ctx, "story", els, { label: n === 0 ? cfg.title.slice(0, 40) || "Story" : `${cfg.title.slice(0, 32) || "Story"} (cont.)` });
  });
}

/* --------------------------- mystery clue boxes --------------------------- */

/**
 * The "Case clue" box under a mystery puzzle: what to do, and one square per
 * letter of the clue for the reader to fill in (the answer key fills them).
 */
function clueBox(ctx: Ctx, width: number, how: string, answer: string, solved = false): { height: number; draw: (x: number, y: number) => Element[] } {
  const st = ctx.style;
  const pad = 10;
  const ls = st.sizes.small;
  const inner = width - pad * 2;
  const howH = textBlockHeight(measureLines(how, st.body, false, ls, inner).length, ls, 1.25);
  const words = answer.toUpperCase().split(/\s+/).map((w) => normalizeWord(w)).filter(Boolean);
  const longest = Math.max(1, ...words.map((w) => w.length));
  const cs = Math.max(11, Math.min(st.largePrint ? 26 : 20, inner / longest));
  const gap = cs * 0.6;
  // Words wrap onto more rows of squares when the clue is too long for one.
  const rows: { word: string; x: number }[][] = [[]];
  let cx = 0;
  for (const w of words) {
    const ww = w.length * cs;
    if (cx > 0 && cx + ww > inner) {
      rows.push([]);
      cx = 0;
    }
    rows[rows.length - 1].push({ word: w, x: cx });
    cx += ww + gap;
  }
  const rowH = cs + 6;
  const height = pad + ls * 1.13 + 4 + howH + 8 + rows.length * rowH + pad - 6;
  const draw = (x: number, y: number): Element[] => {
    const els: Element[] = [rect({ x, y, width, height, fill: "#f3f3f3", stroke: INK, strokeWidth: 0.8, cornerRadius: 6, name: "Case clue box" })];
    els.push(text({ x: x + pad, y: y + pad, width: inner, height: ls * 1.13, text: "CASE CLUE", fontSize: ls, bold: true, fontFamily: st.label, color: INK, letterSpacing: 0.15, name: "Case clue" }));
    els.push(text({ x: x + pad, y: y + pad + ls * 1.13 + 4, width: inner, height: howH, text: how, fontSize: ls, fontFamily: st.body, color: INK, lineHeight: 1.25, name: "Case clue how-to" }));
    let ry = y + pad + ls * 1.13 + 4 + howH + 8;
    for (const row of rows) {
      const rowW = row.length ? row[row.length - 1].x + row[row.length - 1].word.length * cs : 0;
      const ox = x + pad + (inner - rowW) / 2;
      for (const { word, x: wx } of row)
        [...word].forEach((ch, k) => {
          els.push(rect({ x: ox + wx + k * cs, y: ry, width: cs, height: cs, fill: "#ffffff", stroke: INK, strokeWidth: 0.7 }));
          if (solved) els.push(cellText(ox + wx + k * cs, ry, cs, ch, cs * 0.58, { bold: true, family: st.label }));
        });
      ry += rowH;
    }
    return els;
  };
  return { height, draw };
}

interface DividerParts {
  title: string;
  subtitle: string;
  kicker?: string;
  detail?: string;
  howTo?: string;
  aiRunId?: string;
}

function sectionDivider(ctx: Ctx, d: DividerParts): Page {
  const b = ctx.box;
  const st = ctx.style;
  const { family, bold } = st.heading;
  const ai = (el: Element) => (d.aiRunId ? tag(ctx, el, { origin: "ai-generated", runId: d.aiRunId }) : el);
  const cx = b.x + b.width / 2;
  const w = b.width * 0.88;
  const x = b.x + (b.width - w) / 2;

  // Measure every part first so the whole block sits a little above the middle of the page.
  const kSize = Math.max(st.sizes.small, 11);
  const tSize = fitSize(d.title, family, bold, st.sizes.divider, 18, w, 2);
  const tH = textBlockHeight(measureLines(d.title, family, bold, tSize, w).length, tSize, 1.08);
  const sSize = st.sizes.body + 1;
  const subtitle = d.subtitle.trim();
  const sH = subtitle ? textBlockHeight(measureLines(subtitle, st.body, false, sSize, w * 0.9).length, sSize, 1.3) : 0;
  const dSize = st.sizes.small;
  const howSize = st.sizes.small;
  const howW = w * 0.92;
  const howH = d.howTo ? textBlockHeight(measureLines(d.howTo, st.body, false, howSize, howW - 28).length, howSize, 1.35) + 24 + howSize * 1.6 : 0;
  const orn = Math.min(150, b.width * 0.42);
  const ornH = (orn * 24) / 120;
  const total = (d.kicker ? kSize * 1.13 + 14 : 0) + ornH + 22 + tH + (subtitle ? 16 + sH : 0) + (d.detail ? 18 + dSize * 1.13 : 0) + (d.howTo ? 30 + howH : 0);
  let y = b.y + Math.max(0, (b.height - total) * 0.42);

  const els: Element[] = [];
  if (d.kicker) {
    els.push(text({ x, y, width: w, height: kSize * 1.13, text: d.kicker.toUpperCase(), fontSize: kSize, fontFamily: st.label, bold: true, color: "#555555", align: "center", letterSpacing: 0.2, name: "Section number" }));
    y += kSize * 1.13 + 14;
  }
  const o = ornamentElements(ctx, cx, y, orn);
  els.push(...o.els);
  y += o.height + 22;
  els.push(ai(text({ x, y, width: w, height: tH, text: d.title, fontSize: tSize, bold, fontFamily: family, align: "center", lineHeight: 1.08, name: "Section title" })));
  y += tH;
  if (subtitle) {
    y += 16;
    els.push(ai(text({ x: x + w * 0.05, y, width: w * 0.9, height: sH, text: subtitle, fontSize: sSize, fontFamily: st.body, color: "#444444", align: "center", lineHeight: 1.3, name: "Section subtitle" })));
    y += sH;
  }
  if (d.detail) {
    y += 18;
    els.push(text({ x, y, width: w, height: dSize * 1.13, text: d.detail, fontSize: dSize, fontFamily: st.label, color: "#333333", align: "center", name: "Section detail" }));
    y += dSize * 1.13;
  }
  if (d.howTo) {
    y += 30;
    const hx = b.x + (b.width - howW) / 2;
    els.push(rect({ x: hx, y, width: howW, height: howH, fill: "#f2f2f2", stroke: null, strokeWidth: 0, cornerRadius: 8, name: "How to play box" }));
    els.push(text({ x: hx + 14, y: y + 12, width: howW - 28, height: howSize * 1.13, text: "How to play", fontSize: howSize, bold: true, fontFamily: st.label, color: INK }));
    els.push(text({ x: hx + 14, y: y + 12 + howSize * 1.6, width: howW - 28, height: howH - 24 - howSize * 1.6, text: d.howTo, fontSize: howSize, fontFamily: st.body, color: INK, lineHeight: 1.35, name: "How to play" }));
  }
  return page(ctx, "section-divider", els, { hideNumber: true, label: d.title.slice(0, 40) });
}

function tocPage(ctx: Ctx, entries: { title: string; page: number }[]): Page {
  const b = ctx.box;
  const st = ctx.style;
  const head = headingBlock(ctx, "Contents", b.y, Math.round(st.sizes.pageTitle * 1.15));
  const o = ornamentElements(ctx, b.x + b.width / 2, b.y + head.height + 10, 70);
  const els: Element[] = [head.el, ...o.els];
  const top = b.y + head.height + 10 + o.height + 28;
  const rows = entries.slice(0, 28);
  const size = Math.min(st.sizes.body + 1, Math.max(8, ((b.y + b.height - top) / Math.max(1, rows.length)) / 2.2));
  const rowH = size * 2.2;
  const numW = textWidth("000", st.label, false, size) + 4;
  rows.forEach((e, i) => {
    const y = top + i * rowH;
    const titleW = Math.min(b.width - numW - 24, textWidth(e.title, st.body, false, size) + 2);
    els.push(text({ x: b.x, y, width: b.width - numW - 16, height: size * 1.13, text: e.title, fontSize: size, fontFamily: st.body, color: INK }));
    // Dotted leader from the end of the title to the page number.
    const ly = y + size * 0.95;
    if (b.width - numW - 8 - (titleW + 6) > 12) els.push(line({ x: b.x + titleW + 6, y: ly, width: b.width - numW - 8 - (titleW + 6), height: 0, stroke: RULE, strokeWidth: 0.9, dash: [0.1, 3.5], cap: "round" }));
    els.push(text({ x: b.x + b.width - numW, y, width: numW, height: size * 1.13, text: String(e.page), fontSize: size, fontFamily: st.label, color: INK, align: "right" }));
  });
  return page(ctx, "table-of-contents", els, { label: "Contents" });
}

function monthlyCalendarPages(ctx: Ctx, count: number, startDate: string): Page[] {
  const start = parseStart(startDate);
  return Array.from({ length: count }, (_, i) => {
    const b = ctx.box;
    const month = start ? addMonths(start, i) : null;
    const els: Element[] = [];
    const st = ctx.style;
    if (month) els.push(heading(ctx, monthLabel(month), b.y, Math.round(st.sizes.pageTitle * 1.1)));
    else els.push(...labelLine(ctx, "Month:", b.x + b.width * 0.2, b.y + st.sizes.pageTitle, b.width * 0.6, st.sizes.label));
    const top = b.y + st.sizes.pageTitle * 1.1 * 1.13 + 16;
    const daySize = Math.max(8.5, st.sizes.small - 2);
    const headH = daySize * 1.13 + 6;
    const cells = month ? monthGrid(month) : Array<number | null>(35).fill(null);
    const weeks = cells.length / 7;
    const notesH = Math.min(70, b.height * 0.14);
    const cw = b.width / 7;
    const ch = (b.height - (top - b.y) - headH - notesH - 12) / weeks;
    WEEKDAYS_SHORT.forEach((d, k) => els.push(text({ x: b.x + k * cw, y: top + (headH - daySize * 1.13) / 2, width: cw, height: daySize * 1.13, text: d, fontSize: daySize, bold: true, fontFamily: st.label, align: "center", lineHeight: 1 })));
    const gy = top + headH;
    els.push(rect({ x: b.x, y: gy, width: b.width, height: ch * weeks, fill: null, stroke: INK, strokeWidth: 0.8 }));
    for (let w = 1; w < weeks; w++) els.push(line({ x: b.x, y: gy + w * ch, width: b.width, height: 0, stroke: RULE, strokeWidth: 0.5 }));
    for (let k = 1; k < 7; k++) els.push(line({ x: b.x + k * cw, y: gy, width: 0, height: ch * weeks, stroke: RULE, strokeWidth: 0.5 }));
    cells.forEach((day, idx) => {
      if (day === null) return;
      const cx = b.x + (idx % 7) * cw;
      const cy = gy + Math.floor(idx / 7) * ch;
      els.push(text({ x: cx + 3, y: cy + 3, width: cw - 6, height: daySize * 1.13, text: String(day), fontSize: daySize, fontFamily: st.label, color: "#444444" }));
    });
    const ny = gy + ch * weeks + 12;
    const ls = st.sizes.small + 1;
    els.push(fieldLabel(ctx, "Notes", b.x, ny, b.width, ls));
    const sp = inToPt(st.largePrint ? 0.34 : 0.28);
    const n = Math.floor((b.y + b.height - ny - ls * 1.45) / sp);
    if (n > 0) els.push(lineBlock(ctx, ny + ls * 1.45, n, sp));
    return page(ctx, "monthly-calendar", els, { label: month ? monthLabel(month) : undefined });
  });
}

function weeklyPages(ctx: Ctx, count: number, startDate: string): Page[] {
  const start = parseStart(startDate);
  return Array.from({ length: count }, (_, i) => {
    const b = ctx.box;
    const monday = start ? addDays(startOfWeek(start), i * 7) : null;
    const els: Element[] = [];
    const st = ctx.style;
    if (monday) els.push(heading(ctx, `Week of ${shortDate(monday)}, ${monday.getUTCFullYear()}`, b.y));
    else els.push(...labelLine(ctx, "Week of:", b.x + b.width * 0.2, b.y + st.sizes.pageTitle * 0.9, b.width * 0.6, st.sizes.label));
    const top = b.y + st.sizes.pageTitle * 1.13 + 12;
    const ls = st.sizes.small;
    // Seven day boxes in two columns (Mon–Thu left, Fri–Sun + notes right).
    const gap = 10;
    const colW = (b.width - gap) / 2;
    const boxH = (b.y + b.height - top - gap * 3) / 4;
    const slots = [...WEEKDAYS, "Notes"];
    slots.forEach((label, k) => {
      const col = k < 4 ? 0 : 1;
      const row = k % 4;
      const x = b.x + col * (colW + gap);
      const y = top + row * (boxH + gap);
      const day = monday && k < 7 ? ` · ${shortDate(addDays(monday, k))}` : "";
      els.push(rect({ x, y, width: colW, height: boxH, fill: null, stroke: INK, strokeWidth: 0.7, cornerRadius: 3 }));
      els.push(text({ x: x + 6, y: y + 5, width: colW - 12, height: ls * 1.13, text: `${label}${day}`, fontSize: ls, bold: true, fontFamily: st.label }));
      const sp = inToPt(st.largePrint ? 0.32 : 0.25);
      const n = Math.floor((boxH - ls * 1.13 - 14) / sp);
      if (n > 0) els.push(lineBlock(ctx, y + ls * 1.13 + 10, n, sp, x + 6, colW - 12));
    });
    return page(ctx, "weekly-spread", els);
  });
}

/* --------------------------------- puzzles -------------------------------- */

const showPuzzles = (part?: PuzzlePart) => part !== "solutions";
const showSolutions = (cfg: { solutions: boolean; part?: PuzzlePart }) => cfg.solutions && cfg.part !== "puzzles";
/** Only self-contained ("all") sections get their own "Solutions" title page; grouped keys sit under one divider. */
const solutionsTitle = (ctx: Ctx, cfg: { part?: PuzzlePart }, kind: string): Page[] =>
  cfg.part === "solutions" ? [] : [sectionDivider(ctx, { title: "Solutions", subtitle: "" })].map((p) => ({ ...p, generator: { kind }, hideNumber: false, label: "Solutions" }));

function sudokuGrid(ctx: Ctx, s: Sudoku, x: number, y: number, size: number, solution: boolean): Element[] {
  const cell = size / 9;
  const els: Element[] = [];
  const fs = cell * 0.55;
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    const given = s.puzzle[i] !== 0;
    if (given) els.push(cellText(x + c * cell, y + r * cell, cell, String(s.puzzle[i]), fs, { bold: true, family: ctx.style.label }));
    else if (solution) els.push(cellText(x + c * cell, y + r * cell, cell, String(s.solution[i]), fs, { color: "#7a7a7a", family: ctx.style.label }));
  }
  for (let k = 0; k <= 9; k++) {
    const thick = k % 3 === 0;
    const w = thick ? Math.max(1.2, size / 160) : 0.5;
    els.push(line({ x, y: y + k * cell, width: size, height: 0, stroke: INK, strokeWidth: w, cap: "round" }));
    els.push(line({ x: x + k * cell, y, width: 0, height: size, stroke: INK, strokeWidth: w, cap: "round" }));
  }
  return els;
}

function slots(box: Box, perPage: number, labelH: number): { x: number; y: number; size: number }[] {
  const cols = perPage >= 4 ? 2 : 1;
  const rows = Math.ceil(perPage / cols);
  const gap = 18;
  const cellW = (box.width - gap * (cols - 1)) / cols;
  const cellH = (box.height - gap * (rows - 1)) / rows;
  const size = Math.min(cellW, cellH - labelH);
  const out: { x: number; y: number; size: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const sx = box.x + c * (cellW + gap) + (cellW - size) / 2;
      const sy = box.y + r * (cellH + gap) + labelH + (cellH - labelH - size) / 2;
      out.push({ x: sx, y: sy, size });
    }
  return out;
}

function sudokuPages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "sudoku" }>): Page[] {
  const puzzles = Array.from({ length: cfg.count }, (_, i) => generateSudoku(cfg.seed + i, cfg.difficulty));
  const first = cfg.startNumber ?? 1;
  // Each puzzle is labelled with the difficulty it grades at, which is nearly always the section's.
  const label = (d: SudokuDifficulty) => d[0].toUpperCase() + d.slice(1);
  const pages: Page[] = [];
  const st = ctx.style;
  // Two puzzles to a page need a smaller label than one; four smaller still.
  const ls = cfg.perPage === 1 ? st.sizes.label + 2 : cfg.perPage === 2 ? st.sizes.label : Math.max(st.sizes.small, st.sizes.label - 2);
  const labelH = ls * 1.13 + 10;
  if (showPuzzles(cfg.part))
    for (let p = 0; p < puzzles.length; p += cfg.perPage) {
      const els: Element[] = [];
      slots(ctx.box, cfg.perPage, labelH).forEach((slot, k) => {
        const s = puzzles[p + k];
        if (!s) return;
        // Number on the left, difficulty on the right, over the grid's edges.
        const ty = slot.y - labelH + 2;
        els.push(text({ x: slot.x, y: ty, width: slot.size * 0.6, height: ls * 1.13, text: `Puzzle ${first + p + k}`, fontSize: ls, bold: true, fontFamily: st.heading.family, name: "Puzzle number" }));
        els.push(text({ x: slot.x + slot.size * 0.4, y: ty + ls * 0.12, width: slot.size * 0.6, height: ls * 0.9 * 1.13, text: label(s.difficulty).toUpperCase(), fontSize: Math.max(st.sizes.small, ls * 0.8), fontFamily: st.label, letterSpacing: 0.12, color: "#444444", align: "right", name: "Difficulty" }));
        els.push(...sudokuGrid(ctx, s, slot.x, slot.y, slot.size, false));
      });
      pages.push(page(ctx, "sudoku", els, { generator: { kind: "sudoku", seed: cfg.seed, params: { difficulty: cfg.difficulty, from: first + p } } }));
    }
  if (showSolutions(cfg) && puzzles.length) {
    const per = cfg.keysPerPage ?? 6;
    const ks = st.sizes.key;
    pages.push(...solutionsTitle(ctx, cfg, "sudoku-solutions"));
    for (let p = 0; p < puzzles.length; p += per) {
      const els: Element[] = [];
      const box = ctx.box;
      const cols = 2;
      const rows = per / cols;
      const gap = 16;
      const kh = ks * 1.13 + 6;
      const cw = (box.width - gap) / cols;
      const ch = (box.height - gap * (rows - 1)) / rows;
      const size = Math.min(cw, ch - kh);
      for (let k = 0; k < per; k++) {
        const s = puzzles[p + k];
        if (!s) break;
        const cx = box.x + (k % cols) * (cw + gap) + (cw - size) / 2;
        const cy = box.y + Math.floor(k / cols) * (ch + gap) + kh;
        els.push(text({ x: cx, y: cy - kh, width: size, height: ks * 1.13, text: `Puzzle ${first + p + k}`, fontSize: ks, bold: true, fontFamily: st.label }));
        els.push(...sudokuGrid(ctx, s, cx, cy, size, true));
      }
      pages.push(page(ctx, "sudoku-solutions", els));
    }
  }
  return pages;
}

function wordSearchBlock(ws: WordSearch, x: number, y: number, size: number, solution: boolean, family = SANS): Element[] {
  const cell = size / ws.size;
  const els: Element[] = [];
  if (solution) {
    for (const p of ws.placed) {
      const x1 = x + p.col * cell + cell / 2;
      const y1 = y + p.row * cell + cell / 2;
      const x2 = x + (p.col + p.dc * (p.word.length - 1)) * cell + cell / 2;
      const y2 = y + (p.row + p.dr * (p.word.length - 1)) * cell + cell / 2;
      els.push(line({ x: x1, y: y1, width: x2 - x1, height: y2 - y1, stroke: "#c8c8c8", strokeWidth: cell * 0.72, cap: "round" }));
    }
  }
  const fs = cell * 0.58;
  ws.grid.forEach((row, r) => row.forEach((ch, c) => els.push(cellText(x + c * cell, y + r * cell, cell, ch, fs, { bold: !solution, family }))));
  els.push(rect({ x: x - 4, y: y - 4, width: size + 8, height: size + 8, fill: null, stroke: INK, strokeWidth: 1, cornerRadius: 6 }));
  return els;
}

function wordSearchPages(
  ctx: Ctx,
  cfg: { puzzles: { title: string; words: string[]; message?: string }[]; size: number; difficulty: WordSearchDifficulty; aiRunId?: string } & PuzzleCommon,
  kind = "word-search",
  alphabet?: string,
): Page[] {
  const results = cfg.puzzles.map((p, i) => ({ title: p.title, ws: generateWordSearch(p.words, cfg.size, cfg.difficulty, cfg.seed + i, alphabet, p.message), message: p.message?.trim().toUpperCase() ?? "" }));
  const prov: ArtifactProvenance | undefined = cfg.aiRunId ? { origin: "ai-generated", runId: cfg.aiRunId } : undefined;
  const pages: Page[] = !showPuzzles(cfg.part)
    ? []
    : results.map(({ title, ws, message }, i) => {
        const b = ctx.box;
        const st = ctx.style;
        const head = headingBlock(ctx, `${numberOf(cfg, i)}. ${title}`, b.y);
        const nth = ({ 2: "second", 3: "third", 4: "fourth" } as Record<number, string>)[ws.messageStep ?? 1];
        const how = nth
          ? `Find and cross out every word. Then read the letters left over, row by row from the top left, and write down every ${nth} one: they spell the clue.`
          : "Find and cross out every word. The letters left over, read row by row from the top left, spell the clue.";
        const clue = ws.message ? clueBox(ctx, b.width, how, message) : null;
        const clueH = clue ? clue.height + 14 : 0;
        const titleEl = head.el;
        // Word list: three columns (two when a word wouldn't fit), at the small size, shrunk only if needed.
        const words = ws.placed.map((p) => p.word).sort();
        let wsz = st.sizes.small;
        let cols = 3;
        const fits = (n: number, sz: number) => words.every((w) => textWidth(w, st.label, false, sz) <= b.width / n - 8);
        while (!fits(cols, wsz) && wsz > 8) {
          if (cols === 3 && fits(2, wsz)) cols = 2;
          else wsz -= 0.5;
        }
        const rowStep = wsz * 1.5;
        const listH = Math.ceil(words.length / cols) * rowStep + 10;
        const room = b.y + b.height - (b.y + head.height + 14) - clueH;
        const size = Math.min(b.width - 8, room - listH - 18);
        // Grid and list sit together in the middle of the space under the heading.
        const gy = b.y + head.height + 14 + Math.max(0, (room - size - 18 - listH) / 2);
        const gx = b.x + (b.width - size) / 2;
        const els: Element[] = [prov ? tag(ctx, titleEl, prov) : titleEl, ...wordSearchBlock(ws, gx, gy, size, false, st.label)];
        const colW = b.width / cols;
        words.forEach((w, k) => {
          const wordEl = text({ x: b.x + (k % cols) * colW, y: gy + size + 18 + Math.floor(k / cols) * rowStep, width: colW - 4, height: wsz * 1.13, text: w, fontSize: wsz, fontFamily: st.label, align: "center" });
          els.push(prov ? tag(ctx, wordEl, prov) : wordEl);
        });
        if (clue) els.push(...clue.draw(b.x, b.y + b.height - clue.height));
        return page(ctx, kind, els, { generator: { kind, seed: ws.seed, params: { size: cfg.size, difficulty: cfg.difficulty } } });
      });
  if (showSolutions(cfg) && results.length) {
    pages.push(...solutionsTitle(ctx, cfg, `${kind}-solutions`));
    for (let p = 0; p < results.length; p += 4) {
      const els: Element[] = [];
      const ks = ctx.style.sizes.key;
      slots(ctx.box, 4, ks * 1.13 + 8).forEach((slot, k) => {
        const r = results[p + k];
        if (!r) return;
        els.push(text({ x: slot.x, y: slot.y - ks * 1.13 - 8, width: slot.size, height: ks * 1.13, text: `${numberOf(cfg, p + k)}. ${r.title}${r.ws.message ? `  ·  Clue: ${r.message}` : ""}`, fontSize: ks, bold: true, fontFamily: ctx.style.label }));
        els.push(...wordSearchBlock(r.ws, slot.x + 4, slot.y + 4, slot.size - 8, true, ctx.style.label));
      });
      pages.push(page(ctx, `${kind}-solutions`, els));
    }
  }
  return pages;
}

const NUMBER_SEARCH_COUNT: Record<WordSearchDifficulty, number> = { easy: 12, medium: 16, hard: 20 };

/** Random digit strings to hide in a number-search grid (seeded, no duplicates). */
export function numberSearchLists(cfg: Extract<GeneratorConfig, { kind: "number-search" }>): { title: string; words: string[] }[] {
  return Array.from({ length: cfg.count }, (_, i) => {
    const rng = createRng(cfg.seed * 31 + i);
    const words = new Set<string>();
    const maxLen = Math.max(4, Math.min(8, cfg.size - 4));
    while (words.size < NUMBER_SEARCH_COUNT[cfg.difficulty]) {
      const len = randInt(rng, 4, maxLen);
      words.add(Array.from({ length: len }, () => DIGITS[Math.floor(rng() * 10)]).join(""));
    }
    return { title: "Number Search", words: [...words] };
  });
}

const MAZE_SIZE = { easy: 10, medium: 16, hard: 24 } as const;

function mazeElements(m: Maze, x: number, y: number, cell: number, solution: boolean): Element[] {
  const w = m.cols * cell;
  const h = m.rows * cell;
  const els: Element[] = [];
  if (solution) els.push(path({ x, y, width: w, height: h, viewBoxW: w, viewBoxH: h, d: mazeSolutionPath(m, cell), stroke: "#9a9a9a", strokeWidth: Math.max(1, cell * 0.3) }));
  els.push(path({ x, y, width: w, height: h, viewBoxW: w, viewBoxH: h, d: mazeWallsPath(m, cell), stroke: INK, strokeWidth: Math.max(0.8, cell * 0.08) }));
  return els;
}

function mazePages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "maze" }>): Page[] {
  const b = ctx.box;
  const st = ctx.style;
  const ends = st.sizes.small;
  const title = headingBlock(ctx, "Maze 00", b.y);
  const labelH = title.height + 12 + ends * 1.13 + 6;
  const first = cfg.startNumber ?? 1;
  const cols = MAZE_SIZE[cfg.difficulty];
  const cell = (b.width - 8) / cols;
  const rows = Math.max(cols, Math.floor((b.height - labelH - ends * 1.13 - 10) / cell));
  const mazes = Array.from({ length: cfg.count }, (_, i) => generateMaze(cols, rows, cfg.seed + i, cfg.difficulty));
  const pages: Page[] = !showPuzzles(cfg.part)
    ? []
    : mazes.map((m, i) => {
        const w = m.cols * cell;
        const x = b.x + (b.width - w) / 2;
        const y = b.y + labelH;
        // Centered on the opening's column, kept inside the page box.
        const lw = textWidth("FINISH", st.label, true, ends) + 8;
        const labelX = (cellIndex: number) => Math.min(b.x + b.width - lw, Math.max(b.x, x + ((cellIndex % m.cols) + 0.5) * cell - lw / 2));
        return page(
          ctx,
          "maze",
          [
            heading(ctx, `Maze ${first + i}`, b.y),
            // The labels sit over the entrance and under the exit, wherever along the edge they are.
            text({ x: labelX(m.start), y: y - ends * 1.13 - 4, width: lw, height: ends * 1.13, text: "START", fontSize: ends, bold: true, fontFamily: st.label, align: "center" }),
            ...mazeElements(m, x, y, cell, false),
            text({ x: labelX(m.end), y: y + m.rows * cell + 4, width: lw, height: ends * 1.13, text: "FINISH", fontSize: ends, bold: true, fontFamily: st.label, align: "center" }),
          ],
          { generator: { kind: "maze", seed: m.seed, params: { cols, rows } } },
        );
      });
  if (showSolutions(cfg) && mazes.length) {
    pages.push(...solutionsTitle(ctx, cfg, "maze-solutions"));
    for (let p = 0; p < mazes.length; p += 4) {
      const els: Element[] = [];
      const ks = st.sizes.key;
      slots(b, 4, ks * 1.13 + 6).forEach((slot, k) => {
        const m = mazes[p + k];
        if (!m) return;
        const c = Math.min(slot.size / m.cols, slot.size / m.rows);
        els.push(text({ x: slot.x, y: slot.y - ks * 1.13 - 6, width: slot.size, height: ks * 1.13, text: `Maze ${first + p + k}`, fontSize: ks, bold: true, fontFamily: st.label }));
        els.push(...mazeElements(m, slot.x + (slot.size - m.cols * c) / 2, slot.y, c, true));
      });
      pages.push(page(ctx, "maze-solutions", els));
    }
  }
  return pages;
}

const SCRAMBLE_MAX_WORDS = 15;
const SCRAMBLE_KEYS_PER_PAGE = 4;

function scrambleSets(cfg: Extract<GeneratorConfig, { kind: "word-scramble" }>) {
  return cfg.puzzles
    .map((p, i) => {
      // A secret word puts the words that spell it first, each with its letter marked.
      const order = p.secret ? secretOrder(p.words, p.secret) : null;
      const items = scrambleWords(order?.words ?? p.words, cfg.seed + i, cfg.difficulty).slice(0, SCRAMBLE_MAX_WORDS);
      return { title: p.title, items, secret: order ? normalizeWord(p.secret!) : "", marks: order?.marks ?? [] };
    })
    .filter((s) => s.items.length);
}

function scramblePages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "word-scramble" }>): Page[] {
  const b = ctx.box;
  const prov: ArtifactProvenance | undefined = cfg.aiRunId ? { origin: "ai-generated", runId: cfg.aiRunId } : undefined;
  const sets = scrambleSets(cfg);
  const pages: Page[] = [];
  if (showPuzzles(cfg.part))
    sets.forEach(({ title, items, secret, marks }, i) => {
      const st = ctx.style;
      const head = headingBlock(ctx, `${numberOf(cfg, i)}. ${title}`, b.y);
      const titleEl = head.el;
      const els: Element[] = [prov ? tag(ctx, titleEl, prov) : titleEl];
      const hint = secret ? "Unscramble the letters to spell a word from the theme, and write it in the squares." : "Unscramble the letters to spell a word from the theme.";
      const clue = secret ? clueBox(ctx, b.width, `The shaded squares, read from the top answer down, spell the clue.`, secret) : null;
      const hs = st.sizes.small;
      const hintH = textBlockHeight(measureLines(hint, st.body, false, hs, b.width).length, hs, 1.2);
      els.push(text({ x: b.x, y: b.y + head.height + 6, width: b.width, height: hintH, text: hint, fontSize: hs, fontFamily: st.body, color: "#444444", align: "center", lineHeight: 1.2 }));
      const top = b.y + head.height + 6 + hintH + 18;
      const bottom = b.y + b.height - (clue ? clue.height + 14 : 0);
      const rowH = Math.min(st.largePrint ? 44 : 34, (bottom - top) / items.length);
      const size = Math.min(st.largePrint ? 20 : 15, rowH * 0.5);
      // Answer squares when a secret is spelled: as wide as the longest answer allows, no taller than the row.
      const longest = Math.max(...items.map((it) => it.word.length));
      const cs = Math.min(rowH * 0.78, (b.width * 0.5) / longest, st.largePrint ? 26 : 22);
      items.forEach((it, k) => {
        const y = top + k * rowH;
        const wordEl = text({ x: b.x, y, width: b.width * 0.48, height: size * 1.13, text: `${k + 1}.  ${it.scrambled.split("").join(" ")}`, fontSize: size, bold: true, fontFamily: "Roboto Mono" });
        els.push(prov ? tag(ctx, wordEl, prov) : wordEl);
        if (!secret) {
          els.push(line({ x: b.x + b.width * 0.5, y: y + size * 1.13, width: b.width * 0.5, height: 0, stroke: RULE, strokeWidth: 0.6 }));
          return;
        }
        const sy = y + size * 1.13 - cs + 2;
        for (let c = 0; c < it.word.length; c++)
          els.push(rect({ x: b.x + b.width * 0.5 + c * cs, y: sy, width: cs, height: cs, fill: k < marks.length && marks[k] === c ? "#cfcfcf" : "#ffffff", stroke: INK, strokeWidth: 0.7, name: k < marks.length && marks[k] === c ? "Clue square" : undefined }));
      });
      if (clue) els.push(...clue.draw(b.x, b.y + b.height - clue.height));
      pages.push(page(ctx, "word-scramble", els, { generator: { kind: "word-scramble", seed: cfg.seed + i } }));
    });
  if (showSolutions(cfg) && sets.length) {
    pages.push(...solutionsTitle(ctx, cfg, "word-scramble-solutions"));
    // Fixed 2 x 2 grid of answer lists per page keeps the page count predictable.
    const gap = 18;
    const colW = (b.width - gap) / 2;
    const rowH = (b.height - gap) / 2;
    for (let p = 0; p < sets.length; p += SCRAMBLE_KEYS_PER_PAGE) {
      const els: Element[] = [];
      for (let k = 0; k < SCRAMBLE_KEYS_PER_PAGE; k++) {
        const set = sets[p + k];
        if (!set) break;
        const x = b.x + (k % 2) * (colW + gap);
        const y = b.y + Math.floor(k / 2) * (rowH + gap);
        const size = Math.min(ctx.style.sizes.key, (rowH - ctx.style.sizes.key * 1.13 - 7) / ((set.items.length + (set.secret ? 1 : 0)) * 1.13 * 1.18));
        const ks = ctx.style.sizes.key;
        els.push(text({ x, y, width: colW, height: ks * 1.13, text: `${numberOf(cfg, p + k)}. ${set.title}`, fontSize: ks, bold: true, fontFamily: ctx.style.label }));
        const lines = [...set.items.map((it, n) => `${n + 1}. ${it.word}`), ...(set.secret ? [`Clue: ${set.secret}`] : [])];
        els.push(text({ x, y: y + ks * 1.13 + 5, width: colW, height: textBlockHeight(lines.length, size, 1.18), text: lines.join("\n"), fontSize: size, fontFamily: ctx.style.label, lineHeight: 1.18 }));
      }
      pages.push(page(ctx, "word-scramble-solutions", els));
    }
  }
  return pages;
}

/** Hints per difficulty: easier puzzles reveal more of the most common letters. */
export const CRYPTO_HINTS = { easy: 4, medium: 2, hard: 0 } as const;

function cryptogramBlock(c: Cryptogram, x: number, y: number, width: number, maxH: number, solved: boolean): { els: Element[]; height: number } {
  // Each letter gets a cell: a blank (or the answer) on top, the cipher letter underneath.
  const words = c.cipher.split(" ");
  const plainWords = c.plain.split(" ");
  for (let cell = 22; cell >= 12; cell -= 1) {
    const rowH = cell * 2.3;
    const layout: { w: number; row: number; x: number }[] = [];
    let cx = 0;
    let row = 0;
    let fits = true;
    words.forEach((w, i) => {
      const ww = w.length * cell;
      if (ww > width) fits = false;
      if (cx > 0 && cx + ww > width) {
        row++;
        cx = 0;
      }
      layout.push({ w: i, row, x: cx });
      cx += ww + cell * 0.8;
    });
    const height = (row + 1) * rowH;
    if (!fits || height > maxH) continue;
    const els: Element[] = [];
    layout.forEach(({ w, row: r, x: wx }) => {
      [...words[w]].forEach((ch, k) => {
        const lx = x + wx + k * cell;
        const ly = y + r * rowH;
        const isLetter = /[A-Z]/.test(ch);
        const plain = plainWords[w][k];
        const reveal = isLetter && (solved || c.hints.includes(plain));
        if (isLetter) els.push(line({ x: lx + cell * 0.12, y: ly + cell * 1.05, width: cell * 0.76, height: 0, stroke: INK, strokeWidth: 0.6 }));
        if (reveal || !isLetter) els.push(cellText(lx, ly, cell, isLetter ? plain : ch, cell * 0.62, { bold: true, color: solved && !c.hints.includes(plain) ? "#555555" : INK }));
        if (isLetter) els.push(cellText(lx, ly + cell * 1.1, cell, ch, cell * 0.48, { color: "#555555", family: "Roboto Mono" }));
      });
    });
    return { els, height };
  }
  // Too long even at the smallest cell size: print the cipher text as a paragraph.
  return { els: [text({ x, y, width, height: Math.min(maxH, 60), text: solved ? c.plain : c.cipher, fontSize: 11, fontFamily: "Roboto Mono" })], height: Math.min(maxH, 60) };
}

function cryptogramPages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "cryptogram" }>): Page[] {
  const b = ctx.box;
  const first = cfg.startNumber ?? 1;
  const prov: ArtifactProvenance | undefined = cfg.aiRunId ? { origin: "ai-generated", runId: cfg.aiRunId } : undefined;
  const puzzles = cfg.phrases.map((t) => t.trim()).filter(Boolean).map((t, i) => generateCryptogram(t, cfg.seed + i, CRYPTO_HINTS[cfg.difficulty]));
  const pages: Page[] = [];
  const label = (n: number) => `Cryptogram ${numberOf(cfg, n)}`;
  const emit = (solved: boolean, perPage: number, kind: string) => {
    const slotH = (b.height - (perPage - 1) * 24) / perPage;
    for (let p = 0; p < puzzles.length; p += perPage) {
      const els: Element[] = [];
      for (let k = 0; k < perPage; k++) {
        const c = puzzles[p + k];
        if (!c) break;
        const top = b.y + k * (slotH + 24);
        const hint = !solved && c.hints.length ? `  ·  Hint: ${c.hints.map((h) => `${c.key[h]} = ${h}`).join(", ")}` : "";
        const hs = solved ? ctx.style.sizes.key : ctx.style.sizes.label;
        els.push(text({ x: b.x, y: top, width: b.width, height: textBlockHeight(measureLines(`${label(p + k)}${hint}`, ctx.style.label, true, hs, b.width).length, hs, 1.15), text: `${label(p + k)}${hint}`, fontSize: hs, bold: true, fontFamily: ctx.style.label, lineHeight: 1.15 }));
        const block = cryptogramBlock(c, b.x, top + hs * 2.4 + 8, b.width, slotH - hs * 2.4 - 12, solved);
        els.push(...block.els.map((e) => (prov && !solved ? tag(ctx, e, prov) : e)));
      }
      pages.push(page(ctx, kind, els, { generator: { kind, seed: cfg.seed, params: { from: first + p } } }));
    }
  };
  if (showPuzzles(cfg.part)) emit(false, cfg.perPage, "cryptogram");
  if (showSolutions(cfg) && puzzles.length) {
    pages.push(...solutionsTitle(ctx, cfg, "cryptogram-solutions"));
    emit(true, Math.max(cfg.perPage, 3), "cryptogram-solutions");
  }
  return pages;
}

/** Name of the small clue numbers in crossword squares: they can't be large-print size and still fit, so type checks skip them. */
export const SQUARE_NUMBER = "Square number";

/** Answers listed under easy crosswords, so the reader only has to work out where each one goes. */
const showWordBank = (d: CrosswordDifficulty) => d === "easy";

/** Squares of a crossword's key answer (a mystery clue), as "row,col". */
function keyCells(cw: Crossword, key?: string): Set<string> {
  const w = key ? cw.words.find((x) => x.answer === normalizeAnswer(key)) : undefined;
  return new Set(w ? [...w.answer].map((_, k) => (w.dir === "across" ? `${w.row},${w.col + k}` : `${w.row + k},${w.col}`)) : []);
}

function crosswordGrid(ctx: Ctx, cw: Crossword, x: number, y: number, cell: number, solved: boolean, shaded: Set<string> = new Set()): Element[] {
  const els: Element[] = [];
  const starts = new Map(cw.words.map((w) => [`${w.row},${w.col}`, w.number]));
  const numSize = Math.max(5, Math.min(cell * 0.3, 10));
  cw.grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      if (!ch) return;
      const cx = x + c * cell;
      const cy = y + r * cell;
      els.push(rect({ x: cx, y: cy, width: cell, height: cell, fill: shaded.has(`${r},${c}`) ? "#d6d6d6" : "#ffffff", stroke: INK, strokeWidth: Math.max(0.6, cell * 0.035) }));
      const n = starts.get(`${r},${c}`);
      if (n && !solved) els.push(text({ x: cx + 1.5, y: cy + 1, width: cell - 2, height: numSize * 1.13, text: String(n), fontSize: numSize, fontFamily: ctx.style.label, color: INK, lineHeight: 1, name: SQUARE_NUMBER }));
      if (solved) els.push(cellText(cx, cy, cell, ch, cell * 0.58, { bold: true, family: ctx.style.label }));
    }),
  );
  return els;
}

/** Clue lists laid out at `size`: each clue hangs from its number. Returns the elements and the taller column's height. */
function clueColumns(ctx: Ctx, cw: Crossword, x: number, y: number, width: number, size: number, prov?: ArtifactProvenance, star?: string): { els: Element[]; height: number } {
  const st = ctx.style;
  const gap = 14;
  const colW = (width - gap) / 2;
  const numW = textWidth("00.", st.label, true, size) + 4;
  const els: Element[] = [];
  let tallest = 0;
  (["across", "down"] as const).forEach((dir, k) => {
    const cx = x + k * (colW + gap);
    let cy = y;
    els.push(text({ x: cx, y: cy, width: colW, height: size * 1.13, text: dir === "across" ? "Across" : "Down", fontSize: size, bold: true, fontFamily: st.label, color: INK }));
    cy += size * 1.13 + 5;
    for (const w of cw.words.filter((w) => w.dir === dir)) {
      const said = star && w.answer === normalizeAnswer(star) ? `* ${w.clue}` : w.clue;
      const h = textBlockHeight(measureLines(said, st.body, false, size, colW - numW).length, size, 1.2);
      els.push(text({ x: cx, y: cy, width: numW, height: size * 1.13, text: `${w.number}.`, fontSize: size, bold: true, fontFamily: st.label, color: INK }));
      const clue = text({ x: cx + numW, y: cy, width: colW - numW, height: h, text: said, fontSize: size, fontFamily: st.body, color: INK, lineHeight: 1.2 });
      els.push(prov ? tag(ctx, clue, prov) : clue);
      cy += h + size * 0.35;
    }
    tallest = Math.max(tallest, cy - y);
  });
  return { els, height: tallest };
}

function crosswordPages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "crossword" }>): Page[] {
  const b = ctx.box;
  const st = ctx.style;
  const prov: ArtifactProvenance | undefined = cfg.aiRunId ? { origin: "ai-generated", runId: cfg.aiRunId } : undefined;
  const puzzles = crosswordsOf(cfg);
  const pages: Page[] = [];
  // Squares big enough to write in: about 0.3" (0.36" for large print).
  const minCell = st.largePrint ? 26 : 20;
  const minClue = st.largePrint ? LARGE_PRINT_MIN_PT : 8;
  if (showPuzzles(cfg.part))
    puzzles.forEach(({ title, cw, key }, i) => {
      const head = headingBlock(ctx, `${numberOf(cfg, i)}. ${title}`, b.y);
      const top = b.y + head.height + 12;
      const bank = showWordBank(cfg.difficulty) ? `Word bank: ${cw.words.map((w) => w.answer).sort().join("  ·  ")}` : "";
      const shaded = keyCells(cw, key);
      const clue = shaded.size ? clueBox(ctx, b.width, "The answer to the starred (*) clue, in the shaded squares, is the case clue. Copy it here.", key!) : null;
      const clueH = clue ? clue.height + 12 : 0;
      // The largest clue size that still leaves the grid squares big enough to write in.
      let layout: { size: number; cell: number; bankH: number } | null = null;
      for (let size = st.sizes.body; size >= minClue; size -= 0.5) {
        const clues = clueColumns(ctx, cw, b.x, 0, b.width, size, prov, key);
        const bankH = bank ? textBlockHeight(measureLines(bank, st.label, false, size, b.width).length, size, 1.3) + 10 : 0;
        const cell = Math.min(34, b.width / cw.cols, (b.y + b.height - top - 16 - clues.height - bankH - clueH) / cw.rows);
        layout = { size, cell, bankH };
        if (cell >= minCell) break;
      }
      const { size, cell, bankH } = layout!;
      const gx = b.x + (b.width - cw.cols * cell) / 2;
      const titleEl = prov ? tag(ctx, head.el, prov) : head.el;
      const els: Element[] = [titleEl, ...crosswordGrid(ctx, cw, gx, top, cell, false, shaded)];
      const cy = top + cw.rows * cell + 16;
      els.push(...clueColumns(ctx, cw, b.x, cy, b.width, size, prov, key).els);
      if (bank) els.push(text({ x: b.x, y: b.y + b.height - bankH - clueH + 10, width: b.width, height: bankH - 10, text: bank, fontSize: size, fontFamily: st.label, color: "#333333", align: "center", lineHeight: 1.3, name: "Word bank" }));
      if (clue) els.push(...clue.draw(b.x, b.y + b.height - clue.height));
      pages.push(page(ctx, "crossword", els, { generator: { kind: "crossword", seed: cw.seed, params: { size: cfg.size, difficulty: cfg.difficulty } } }));
    });
  if (showSolutions(cfg) && puzzles.length) {
    pages.push(...solutionsTitle(ctx, cfg, "crossword-solutions"));
    const ks = st.sizes.key;
    for (let p = 0; p < puzzles.length; p += 4) {
      const els: Element[] = [];
      slots(b, 4, ks * 1.13 + 6).forEach((slot, k) => {
        const z = puzzles[p + k];
        if (!z) return;
        const c = Math.min(slot.size / z.cw.cols, slot.size / z.cw.rows);
        const shaded = keyCells(z.cw, z.key);
        els.push(text({ x: slot.x, y: slot.y - ks * 1.13 - 6, width: slot.size, height: ks * 1.13, text: `${numberOf(cfg, p + k)}. ${z.title}${shaded.size ? `  ·  Clue: ${normalizeAnswer(z.key!)}` : ""}`, fontSize: ks, bold: true, fontFamily: st.label }));
        els.push(...crosswordGrid(ctx, z.cw, slot.x + (slot.size - z.cw.cols * c) / 2, slot.y, c, true, shaded));
      });
      pages.push(page(ctx, "crossword-solutions", els));
    }
  }
  return pages;
}

function coloringPages(ctx: Ctx, assetIds: string[], blankBacks: boolean): Page[] {
  const pages: Page[] = [];
  for (const id of assetIds) {
    const asset = ctx.assets.get(id);
    if (!asset) continue;
    const b = ctx.box;
    const scale = Math.min(b.width / asset.widthPx, b.height / asset.heightPx);
    const w = asset.widthPx * scale;
    const h = asset.heightPx * scale;
    pages.push(
      page(ctx, "coloring", [
        tag(ctx, { id: newId("el"), type: "image", assetId: id, x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2, width: w, height: h, rotation: 0 }, { origin: asset.origin }),
      ]),
    );
    if (blankBacks) pages.push(page(ctx, "blank", [], { hideNumber: true, label: "Blank back" }));
  }
  return pages;
}

/* --------------------------------- entry ---------------------------------- */

export interface GenerateOptions {
  spec: PrintSpec;
  /** Interior look (faces, type sizes, ornament); classic when unset. */
  style?: InteriorStyle;
  /** Expected total page count (drives the gutter margin). */
  pageCountHint: number;
  assets?: Asset[];
}

/** Content box used by generators: symmetric margins plus room for page numbers. */
export function generatorBox(spec: PrintSpec, pageCountHint: number): Box {
  const g = interiorGeometry(spec, pageCountHint);
  const box = symmetricContentBox(g, 0.5);
  const reserve = inToPt(0.3);
  return { ...box, height: box.height - reserve };
}

function makeCtx(kind: GeneratorKind, opts: GenerateOptions): Ctx {
  const g = interiorGeometry(opts.spec, opts.pageCountHint);
  return {
    box: generatorBox(opts.spec, opts.pageCountHint),
    style: opts.style ?? CLASSIC_STYLE,
    trimW: g.trimW,
    trimH: g.trimH,
    prov: { origin: "generated", generator: kind },
    assets: new Map((opts.assets ?? []).map((a) => [a.id, a])),
  };
}

/** Pages a chapter needs at the style's body size, so a book can be planned before it is laid out. */
export function storyPagesNeeded(story: { title: string; kicker?: string; body: string }, opts: GenerateOptions): number {
  const ctx = makeCtx("story", opts);
  const at = (size: number) => layoutStory(ctx, story.title, story.kicker ?? "", story.body, size).pages.length;
  const full = at(ctx.style.sizes.body);
  // A chapter that spills a few lines onto another page is set a point smaller instead (the renderer shrinks it to fit).
  return full > 1 && at(Math.max(storyMin(ctx.style), ctx.style.sizes.body - 1)) < full ? full - 1 : full;
}

export function generatePages(cfg: GeneratorConfig, opts: GenerateOptions): Page[] {
  const ctx = makeCtx(cfg.kind, opts);
  switch (cfg.kind) {
    case "blank":
      // Blank pages carry no number, as in printed books.
      return Array.from({ length: cfg.count }, () => page(ctx, "blank", [], { hideNumber: true }));
    case "lined":
      return ruledPages(ctx, cfg.count, inToPt(cfg.spacingIn), cfg.header);
    case "dot-grid":
      return Array.from({ length: cfg.count }, () =>
        page(ctx, "dot-grid", [pattern({ ...ctx.box, pattern: { kind: "dots", spacing: inToPt(cfg.spacingIn), radius: 0.7 }, stroke: "#7a7a7a", strokeWidth: 0.5 })]),
      );
    case "graph":
      return Array.from({ length: cfg.count }, () =>
        page(ctx, "graph", [pattern({ ...ctx.box, pattern: { kind: "grid", spacing: inToPt(cfg.spacingIn), majorEvery: cfg.majorEvery || undefined }, stroke: LIGHT, strokeWidth: 0.4 })]),
      );
    case "handwriting":
      return Array.from({ length: cfg.count }, () =>
        page(ctx, "handwriting", [
          ...labelLine(ctx, "Name:", ctx.box.x, ctx.box.y + 14, ctx.box.width * 0.6),
          pattern({ x: ctx.box.x, y: ctx.box.y + 30, width: ctx.box.width, height: ctx.box.height - 30, pattern: { kind: "handwriting", rowHeight: inToPt(cfg.rowHeightIn), gap: inToPt(0.25) }, stroke: "#6f6f6f", strokeWidth: 0.6 }),
        ]),
      );
    case "music":
      return Array.from({ length: cfg.count }, () =>
        page(ctx, "music", [pattern({ ...ctx.box, pattern: { kind: "staff", staves: cfg.staves, lineGap: Math.min(7, ctx.box.height / (cfg.staves * 7)) }, stroke: "#333333", strokeWidth: 0.5 })]),
      );
    case "journal-prompts":
      return journalPromptPages(ctx, cfg.prompts.filter((t) => t.trim()), inToPt(cfg.spacingIn), cfg.aiRunId);
    case "gratitude":
      return gratitudePages(ctx, cfg.count, cfg.affirmations, cfg.aiRunId);
    case "daily-planner":
      return plannerPages(ctx, cfg.count);
    case "habit-tracker":
      return habitPages(ctx, cfg.count, cfg.habits);
    case "log":
      return logPages(ctx, cfg.count, cfg.title, cfg.columns, cfg.rows);
    case "title-page":
      return [titlePage(ctx, cfg.title, cfg.subtitle, cfg.author)];
    case "belongs-to":
      return [belongsToPage(ctx)];
    case "text-page":
      return [textPage(ctx, cfg.title, cfg.body, cfg.aiRunId)];
    case "story":
      return storyPages(ctx, cfg);
    case "section-divider":
      return [...(cfg.blankBefore ? [page(ctx, "blank", [], { hideNumber: true, label: "Blank" })] : []), sectionDivider(ctx, cfg)];
    case "table-of-contents":
      return [tocPage(ctx, cfg.entries)];
    case "monthly-calendar":
      return monthlyCalendarPages(ctx, cfg.count, cfg.startDate);
    case "weekly-spread":
      return weeklyPages(ctx, cfg.count, cfg.startDate);
    case "sudoku":
      return sudokuPages(ctx, cfg);
    case "word-search":
      return wordSearchPages(ctx, { ...cfg, puzzles: cfg.puzzles.filter((pz) => pz.words.length) });
    case "number-search":
      return wordSearchPages(ctx, { ...cfg, puzzles: numberSearchLists(cfg) }, "number-search", DIGITS);
    case "maze":
      return mazePages(ctx, cfg);
    case "word-scramble":
      return scramblePages(ctx, cfg);
    case "crossword":
      return crosswordPages(ctx, cfg);
    case "cryptogram":
      return cryptogramPages(ctx, cfg);
    case "coloring":
      return coloringPages(ctx, cfg.assetIds, cfg.blankBacks);
  }
}

/** Exact page count a config will produce (used to plan books and fill the table of contents before generation). */
export function estimatePageCount(cfg: GeneratorConfig): number {
  const puzzlePages = (c: { part?: PuzzlePart; solutions: boolean }, n: number, puzzles: number, keys: number) =>
    (showPuzzles(c.part) ? puzzles : 0) + (showSolutions(c) && n ? (c.part === "solutions" ? 0 : 1) + keys : 0);
  switch (cfg.kind) {
    case "journal-prompts":
      return cfg.prompts.filter((t) => t.trim()).length;
    case "section-divider":
      return cfg.blankBefore ? 2 : 1;
    case "title-page":
    case "belongs-to":
    case "text-page":
    case "table-of-contents":
      return 1;
    case "sudoku":
      return puzzlePages(cfg, cfg.count, Math.ceil(cfg.count / cfg.perPage), Math.ceil(cfg.count / (cfg.keysPerPage ?? 6)));
    case "word-search": {
      const n = cfg.puzzles.filter((pz) => pz.words.length).length;
      return puzzlePages(cfg, n, n, Math.ceil(n / 4));
    }
    case "number-search":
      return puzzlePages(cfg, cfg.count, cfg.count, Math.ceil(cfg.count / 4));
    case "maze":
      return puzzlePages(cfg, cfg.count, cfg.count, Math.ceil(cfg.count / 4));
    case "word-scramble": {
      const n = scrambleSets(cfg).length;
      return puzzlePages(cfg, n, n, Math.ceil(n / SCRAMBLE_KEYS_PER_PAGE));
    }
    case "crossword": {
      const n = crosswordCount(cfg);
      return puzzlePages(cfg, n, n, Math.ceil(n / 4));
    }
    case "cryptogram": {
      const n = cfg.phrases.filter((t) => t.trim()).length;
      return puzzlePages(cfg, n, Math.ceil(n / cfg.perPage), Math.ceil(n / Math.max(cfg.perPage, 3)));
    }
    case "coloring":
      return cfg.assetIds.length * (cfg.blankBacks ? 2 : 1);
    case "story":
      return Math.max(1, cfg.pages);
    default:
      return cfg.count;
  }
}

/** Number of puzzles a puzzle config contains (for numbering consecutive sections). */
export function puzzleCount(cfg: GeneratorConfig): number {
  switch (cfg.kind) {
    case "sudoku":
    case "maze":
    case "number-search":
      return cfg.count;
    case "word-search":
      return cfg.puzzles.filter((pz) => pz.words.length).length;
    case "word-scramble":
      return scrambleSets(cfg).length;
    case "crossword":
      return crosswordCount(cfg);
    case "cryptogram":
      return cfg.phrases.filter((t) => t.trim()).length;
    default:
      return 0;
  }
}

/** A crossword prints when at least one of its answers fits the grid (the engine always places the first). */
const printable = (p: { entries: { answer: string; clue: string }[] }, size: number) =>
  p.entries.some((e) => e.clue.trim() && normalizeAnswer(e.answer).length >= 3 && normalizeAnswer(e.answer).length <= size);

/** The crosswords a config prints, laid out from its seed (pages, answer keys and stats all use this). */
export function crosswordsOf(cfg: Extract<GeneratorConfig, { kind: "crossword" }>): { title: string; cw: Crossword; key?: string }[] {
  return cfg.puzzles.filter((p) => printable(p, cfg.size)).map((p, i) => ({ title: p.title, cw: generateCrossword(p.entries, cfg.size, cfg.difficulty, cfg.seed + i, p.key), ...(p.key ? { key: p.key } : {}) }));
}

function crosswordCount(cfg: Extract<GeneratorConfig, { kind: "crossword" }>): number {
  return cfg.puzzles.filter((p) => printable(p, cfg.size)).length;
}
