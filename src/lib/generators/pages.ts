import { interiorGeometry, symmetricContentBox, type Box } from "@/lib/kdp/geometry";
import { line, path, pattern, rect, text } from "@/lib/schema/elements";
import type { ArtifactProvenance, Asset, Element, Page, PrintSpec } from "@/lib/schema/project";
import { approxMeasure, textBlockHeight, wrapText } from "@/lib/render/textLayout";
import { inToPt, newId } from "@/lib/util/ids";
import { addDays, addMonths, monthGrid, monthLabel, parseStart, shortDate, startOfWeek, WEEKDAYS, WEEKDAYS_SHORT } from "./calendar";
import { generateCryptogram, type Cryptogram } from "./cryptogram";
import { generateMaze, mazeSolutionPath, mazeWallsPath, type Maze } from "./maze";
import { createRng, randInt, randomSeed } from "./rng";
import { scrambleWords } from "./scramble";
import { generateSudoku, type Sudoku, type SudokuDifficulty } from "./sudoku";
import { DIGITS, generateWordSearch, type WordSearch, type WordSearchDifficulty } from "./wordsearch";

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
}

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
  | { kind: "section-divider"; title: string; subtitle: string; aiRunId?: string }
  | { kind: "table-of-contents"; entries: { title: string; page: number }[] }
  | { kind: "monthly-calendar"; count: number; startDate: string }
  | { kind: "weekly-spread"; count: number; startDate: string }
  | ({ kind: "sudoku"; count: number; difficulty: SudokuDifficulty; perPage: 1 | 2 | 4 } & PuzzleCommon)
  | ({
      kind: "word-search";
      puzzles: { title: string; words: string[] }[];
      size: number;
      difficulty: WordSearchDifficulty;
      aiRunId?: string;
    } & PuzzleCommon)
  | ({ kind: "number-search"; count: number; size: number; difficulty: WordSearchDifficulty } & PuzzleCommon)
  | ({ kind: "maze"; count: number; difficulty: "easy" | "medium" | "hard" } & PuzzleCommon)
  | ({ kind: "word-scramble"; puzzles: { title: string; words: string[] }[]; aiRunId?: string } & PuzzleCommon)
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
  { kind: "cryptogram", label: "Cryptogram", group: "Puzzles", description: "Decode letter-substitution sayings", defaults: () => ({ kind: "cryptogram", phrases: ["Slow and steady wins the race", "A journey of a thousand miles begins with a single step"], difficulty: "medium", perPage: 2, solutions: true, seed: randomSeed() }) },
  { kind: "coloring", label: "Coloring pages", group: "Art", description: "Your line art, one per page, blank backs", defaults: () => ({ kind: "coloring", assetIds: [], blankBacks: true }) },
  { kind: "title-page", label: "Title page", group: "Front matter", description: "Title, subtitle and author", defaults: () => ({ kind: "title-page", title: "Title", subtitle: "", author: "" }) },
  { kind: "belongs-to", label: "This book belongs to", group: "Front matter", description: "Ownership page", defaults: () => ({ kind: "belongs-to" }) },
  { kind: "text-page", label: "Text page", group: "Front matter", description: "Heading and paragraphs: how to use, introduction, thank-you", defaults: () => ({ kind: "text-page", title: "How to Use This Book", body: "Write a short introduction here." }) },
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
const SERIF = "Lora";

interface Ctx {
  box: Box;
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

function heading(ctx: Ctx, s: string, y: number, size = 16, family = SANS): Element {
  return text({ x: ctx.box.x, y, width: ctx.box.width, text: s, fontSize: size, bold: true, fontFamily: family, align: "center", color: INK, height: size * 1.13 });
}

function labelLine(ctx: Ctx, label: string, x: number, y: number, width: number, size = 10): Element[] {
  return [
    text({ x, y: y - size * 1.1, width: width, text: label, fontSize: size, color: INK, height: size * 1.13 }),
    line({ x: x + label.length * size * 0.55 + 4, y, width: width - label.length * size * 0.55 - 4, height: 0, stroke: RULE, strokeWidth: 0.6 }),
  ];
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
      els.push(...labelLine(ctx, "Date:", ctx.box.x, top + 14, ctx.box.width * 0.45));
      top += 28;
    }
    els.push(pattern({ x: ctx.box.x, y: top, width: ctx.box.width, height: ctx.box.y + ctx.box.height - top, pattern: { kind: "lines", spacing }, stroke: RULE, strokeWidth: 0.5 }));
    return page(ctx, "lined", els);
  });
}

function journalPromptPages(ctx: Ctx, prompts: string[], spacing: number, aiRunId?: string): Page[] {
  const promptProv: ArtifactProvenance | undefined = aiRunId ? { origin: "ai-generated", runId: aiRunId } : undefined;
  return prompts.map((prompt) => {
    const promptEl = text({ x: ctx.box.x, y: ctx.box.y, width: ctx.box.width, height: 50, text: prompt, fontSize: 14, fontFamily: SERIF, bold: true, color: INK, align: "left", lineHeight: 1.2 });
    const lines = Math.max(1, Math.ceil((prompt.length * 14 * 0.5) / ctx.box.width));
    const top = ctx.box.y + lines * 14 * 1.13 * 1.2 + 18;
    return page(ctx, "journal-prompts", [
      promptProv ? tag(ctx, promptEl, promptProv) : promptEl,
      pattern({ x: ctx.box.x, y: top, width: ctx.box.width, height: ctx.box.y + ctx.box.height - top, pattern: { kind: "lines", spacing }, stroke: RULE, strokeWidth: 0.5 }),
    ]);
  });
}

function lineBlock(ctx: Ctx, top: number, count: number, spacing: number, x = ctx.box.x, width = ctx.box.width): Element {
  return pattern({ x, y: top, width, height: count * spacing, pattern: { kind: "lines", spacing }, stroke: RULE, strokeWidth: 0.5 });
}

function gratitudePages(ctx: Ctx, count: number, affirmations: string[] = [], aiRunId?: string): Page[] {
  const sp = inToPt(0.3125);
  const lines = affirmations.map((a) => a.trim()).filter(Boolean);
  const affProv: ArtifactProvenance | undefined = aiRunId ? { origin: "ai-generated", runId: aiRunId } : undefined;
  return Array.from({ length: count }, (_, i) => {
    const b = ctx.box;
    const els: Element[] = [heading(ctx, "Today I Am Grateful", b.y, 18, SERIF)];
    let y = b.y + 40;
    els.push(...labelLine(ctx, "Date:", b.x, y, b.width * 0.5));
    y += 24;
    const affirmation = lines.length ? lines[i % lines.length] : null;
    if (affirmation) {
      const size = 11;
      const h = textBlockHeight(wrapText(`“${affirmation}”`, b.width, approxMeasure(size)).length, size, 1.25);
      const el = text({ x: b.x, y, width: b.width, height: h, text: `“${affirmation}”`, fontSize: size, fontFamily: SERIF, color: "#333333", align: "center", lineHeight: 1.25, name: "Affirmation" });
      els.push(affProv ? tag(ctx, el, affProv) : el);
      y += h + 14;
    }
    const section = (title: string, lines: number, numbered = false) => {
      els.push(text({ x: b.x, y, width: b.width, text: title, fontSize: 11, bold: true, color: INK, height: 12.5 }));
      y += 16;
      for (let i = 0; i < lines; i++) {
        if (numbered) els.push(text({ x: b.x, y: y + i * sp + sp - 12, width: 14, text: `${i + 1}.`, fontSize: 10, color: INK, height: 11.3 }));
      }
      els.push(lineBlock(ctx, y, lines, sp, numbered ? b.x + 16 : b.x, numbered ? b.width - 16 : b.width));
      y += lines * sp + 16;
    };
    section("Three things I'm grateful for:", 3, true);
    section("Today's highlight:", 3);
    if (!affirmation) section("Today's affirmation:", 2);
    section("How could today have been better?", 2);
    const remaining = Math.floor((b.y + b.height - y - 16) / sp);
    if (remaining > 0) section("Notes:", remaining);
    return page(ctx, "gratitude", els);
  });
}

function checkbox(x: number, y: number, s = 9): Element {
  return rect({ x, y, width: s, height: s, fill: null, stroke: INK, strokeWidth: 0.6 });
}

function plannerPages(ctx: Ctx, count: number): Page[] {
  return Array.from({ length: count }, () => {
    const b = ctx.box;
    const els: Element[] = [heading(ctx, "Daily Planner", b.y, 18, SERIF)];
    let y = b.y + 40;
    els.push(...labelLine(ctx, "Date:", b.x, y, b.width * 0.5));
    y += 22;
    const colGap = 14;
    const leftW = (b.width - colGap) * 0.55;
    const rightX = b.x + leftW + colGap;
    const rightW = b.width - leftW - colGap;
    const bottom = b.y + b.height;
    // Schedule column
    els.push(text({ x: b.x, y, width: leftW, text: "Schedule", fontSize: 11, bold: true, height: 12.5 }));
    const hours = ["6 AM", "7", "8", "9", "10", "11", "12 PM", "1", "2", "3", "4", "5", "6", "7", "8", "9 PM"];
    const rowH = (bottom - (y + 18)) / hours.length;
    hours.forEach((h, i) => {
      const ry = y + 18 + i * rowH;
      els.push(text({ x: b.x, y: ry + rowH - 12, width: 34, text: h, fontSize: 8, color: "#444444", height: 9 }));
      els.push(line({ x: b.x + 36, y: ry + rowH, width: leftW - 36, height: 0, stroke: RULE, strokeWidth: 0.5 }));
    });
    // Right column
    let ry = y;
    const sp = inToPt(0.3);
    els.push(text({ x: rightX, y: ry, width: rightW, text: "Top Priorities", fontSize: 11, bold: true, height: 12.5 }));
    ry += 18;
    for (let i = 0; i < 3; i++) {
      els.push(checkbox(rightX, ry + sp - 11), line({ x: rightX + 14, y: ry + sp, width: rightW - 14, height: 0, stroke: RULE, strokeWidth: 0.5 }));
      ry += sp;
    }
    ry += 16;
    els.push(text({ x: rightX, y: ry, width: rightW, text: "To Do", fontSize: 11, bold: true, height: 12.5 }));
    ry += 18;
    for (let i = 0; i < 8; i++) {
      els.push(checkbox(rightX, ry + sp - 11), line({ x: rightX + 14, y: ry + sp, width: rightW - 14, height: 0, stroke: RULE, strokeWidth: 0.5 }));
      ry += sp;
    }
    ry += 16;
    els.push(text({ x: rightX, y: ry, width: rightW, text: "Notes", fontSize: 11, bold: true, height: 12.5 }));
    ry += 16;
    const noteLines = Math.floor((bottom - ry) / sp);
    if (noteLines > 0) els.push(lineBlock(ctx, ry, noteLines, sp, rightX, rightW));
    return page(ctx, "daily-planner", els);
  });
}

function habitPages(ctx: Ctx, count: number, habits: number): Page[] {
  return Array.from({ length: count }, () => {
    const b = ctx.box;
    const els: Element[] = [heading(ctx, "Habit Tracker", b.y, 18, SERIF)];
    let y = b.y + 36;
    els.push(...labelLine(ctx, "Month:", b.x, y, b.width * 0.5));
    y += 18;
    const nameW = Math.min(b.width * 0.28, 120);
    const cell = (b.width - nameW) / 31;
    const rowH = Math.min(cell * 1.6, (b.y + b.height - y - cell) / habits);
    const gridH = cell + rowH * habits;
    for (let d = 0; d < 31; d++) els.push(cellText(b.x + nameW + d * cell, y, cell, String(d + 1), Math.min(7, cell * 0.6)));
    els.push(rect({ x: b.x, y, width: b.width, height: gridH, fill: null, stroke: INK, strokeWidth: 0.8 }));
    els.push(line({ x: b.x, y: y + cell, width: b.width, height: 0, stroke: INK, strokeWidth: 0.8 }));
    for (let h = 1; h < habits; h++) els.push(line({ x: b.x, y: y + cell + h * rowH, width: b.width, height: 0, stroke: LIGHT, strokeWidth: 0.5 }));
    els.push(line({ x: b.x + nameW, y, width: 0, height: gridH, stroke: INK, strokeWidth: 0.8 }));
    for (let d = 1; d < 31; d++) els.push(line({ x: b.x + nameW + d * cell, y, width: 0, height: gridH, stroke: LIGHT, strokeWidth: 0.4 }));
    els.push(text({ x: b.x + 4, y: y + (cell - 9) / 2, width: nameW - 8, text: "Habit", fontSize: 8, bold: true, height: 9 }));
    return page(ctx, "habit-tracker", els);
  });
}

function logPages(ctx: Ctx, count: number, title: string, columns: string[], rows: number): Page[] {
  const cols = columns.length ? columns : ["Entry"];
  return Array.from({ length: count }, () => {
    const b = ctx.box;
    const els: Element[] = [heading(ctx, title, b.y, 16, SERIF)];
    const top = b.y + 30;
    const headerH = 18;
    const rowH = (b.y + b.height - top - headerH) / rows;
    const colW = b.width / cols.length;
    els.push(rect({ x: b.x, y: top, width: b.width, height: headerH, fill: "#e6e6e6", stroke: INK, strokeWidth: 0.8 }));
    cols.forEach((c, i) => els.push(text({ x: b.x + i * colW + 3, y: top + 4, width: colW - 6, text: c, fontSize: 8.5, bold: true, align: "center", height: 9.6 })));
    els.push(rect({ x: b.x, y: top, width: b.width, height: headerH + rowH * rows, fill: null, stroke: INK, strokeWidth: 0.8 }));
    for (let r = 1; r <= rows - 1; r++) els.push(line({ x: b.x, y: top + headerH + r * rowH, width: b.width, height: 0, stroke: RULE, strokeWidth: 0.5 }));
    for (let i = 1; i < cols.length; i++) els.push(line({ x: b.x + i * colW, y: top, width: 0, height: headerH + rowH * rows, stroke: RULE, strokeWidth: 0.5 }));
    return page(ctx, "log", els);
  });
}

/* ------------------------------ front matter ----------------------------- */

function titlePage(ctx: Ctx, title: string, subtitle: string, author: string): Page {
  const b = ctx.box;
  const els: Element[] = [
    text({ x: b.x, y: b.y + b.height * 0.3, width: b.width, height: 80, text: title, fontSize: 28, bold: true, fontFamily: SERIF, align: "center", lineHeight: 1.1 }),
  ];
  if (subtitle) els.push(text({ x: b.x, y: b.y + b.height * 0.3 + 90, width: b.width, height: 40, text: subtitle, fontSize: 14, fontFamily: SERIF, align: "center", color: "#333333" }));
  if (author) els.push(text({ x: b.x, y: b.y + b.height * 0.75, width: b.width, height: 20, text: author, fontSize: 14, align: "center" }));
  return page(ctx, "title-page", els, { hideNumber: true, label: "Title page" });
}

function belongsToPage(ctx: Ctx): Page {
  const b = ctx.box;
  const y = b.y + b.height * 0.4;
  return page(
    ctx,
    "belongs-to",
    [
      text({ x: b.x, y, width: b.width, height: 30, text: "This Book Belongs To", fontSize: 22, fontFamily: SERIF, bold: true, align: "center" }),
      line({ x: b.x + b.width * 0.15, y: y + 80, width: b.width * 0.7, height: 0, stroke: INK, strokeWidth: 0.8 }),
    ],
    { hideNumber: true, label: "Belongs to" },
  );
}

/** Largest font size (max..min) at which `body` fits in `height`; returns the size and wrapped height. */
function fitBody(body: string, width: number, height: number, max: number, min: number, lineHeight: number): { size: number; height: number } {
  for (let size = max; size >= min; size -= 0.5) {
    const h = textBlockHeight(wrapText(body, width, approxMeasure(size)).length, size, lineHeight);
    if (h <= height) return { size, height: h };
  }
  return { size: min, height: Math.min(height, textBlockHeight(wrapText(body, width, approxMeasure(min)).length, min, lineHeight)) };
}

function textPage(ctx: Ctx, title: string, body: string, aiRunId?: string): Page {
  const b = ctx.box;
  const els: Element[] = [];
  let top = b.y;
  if (title.trim()) {
    els.push(heading(ctx, title, top, 20, SERIF));
    els.push(line({ x: b.x + b.width / 2 - 30, y: top + 32, width: 60, height: 0, stroke: INK, strokeWidth: 1 }));
    top += 52;
  }
  const clean = body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (clean) {
    const lh = 1.45;
    const fit = fitBody(clean, b.width, b.y + b.height - top, 12, 9, lh);
    const el = text({ x: b.x, y: top, width: b.width, height: fit.height, text: clean, fontSize: fit.size, fontFamily: SERIF, color: INK, align: "left", lineHeight: lh, name: "Body" });
    els.push(aiRunId ? tag(ctx, el, { origin: "ai-generated", runId: aiRunId }) : el);
  }
  return page(ctx, "text-page", els, { label: title.slice(0, 40) || "Text page" });
}

function sectionDivider(ctx: Ctx, title: string, subtitle: string, aiRunId?: string): Page {
  const b = ctx.box;
  const y = b.y + b.height * 0.36;
  const ai = (el: Element) => (aiRunId ? tag(ctx, el, { origin: "ai-generated", runId: aiRunId }) : el);
  const els: Element[] = [
    line({ x: b.x + b.width / 2 - 40, y: y - 24, width: 80, height: 0, stroke: INK, strokeWidth: 1.2 }),
    ai(text({ x: b.x, y, width: b.width, height: 64, text: title, fontSize: 26, bold: true, fontFamily: SERIF, align: "center", lineHeight: 1.1, name: "Section title" })),
  ];
  if (subtitle.trim()) els.push(ai(text({ x: b.x + 20, y: y + 74, width: b.width - 40, height: 40, text: subtitle, fontSize: 12, fontFamily: SERIF, color: "#444444", align: "center", lineHeight: 1.3, name: "Section subtitle" })));
  return page(ctx, "section-divider", els, { hideNumber: true, label: title.slice(0, 40) });
}

function tocPage(ctx: Ctx, entries: { title: string; page: number }[]): Page {
  const b = ctx.box;
  const els: Element[] = [heading(ctx, "Contents", b.y, 20, SERIF)];
  const rows = entries.slice(0, 28);
  const rowH = Math.min(24, (b.height - 56) / Math.max(1, rows.length));
  const size = Math.min(12, rowH * 0.55);
  rows.forEach((e, i) => {
    const y = b.y + 56 + i * rowH;
    const num = String(e.page);
    const numW = 36;
    els.push(text({ x: b.x, y, width: b.width - numW - 8, height: size * 1.13, text: e.title, fontSize: size, fontFamily: SERIF, color: INK }));
    els.push(line({ x: b.x, y: y + size * 1.13 + 2, width: b.width, height: 0, stroke: LIGHT, strokeWidth: 0.4, dash: [1, 2] }));
    els.push(text({ x: b.x + b.width - numW, y, width: numW, height: size * 1.13, text: num, fontSize: size, fontFamily: SERIF, color: INK, align: "right" }));
  });
  return page(ctx, "table-of-contents", els, { label: "Contents" });
}

function monthlyCalendarPages(ctx: Ctx, count: number, startDate: string): Page[] {
  const start = parseStart(startDate);
  return Array.from({ length: count }, (_, i) => {
    const b = ctx.box;
    const month = start ? addMonths(start, i) : null;
    const els: Element[] = [];
    if (month) els.push(heading(ctx, monthLabel(month), b.y, 20, SERIF));
    else els.push(...labelLine(ctx, "Month:", b.x + b.width * 0.2, b.y + 18, b.width * 0.6, 13));
    const top = b.y + 40;
    const headH = 16;
    const cells = month ? monthGrid(month) : Array<number | null>(35).fill(null);
    const weeks = cells.length / 7;
    const notesH = Math.min(70, b.height * 0.14);
    const cw = b.width / 7;
    const ch = (b.height - (top - b.y) - headH - notesH - 12) / weeks;
    WEEKDAYS_SHORT.forEach((d, k) => els.push(text({ x: b.x + k * cw, y: top + (headH - 9.6) / 2 - 2, width: cw, height: 9.6, text: d, fontSize: 8.5, bold: true, align: "center", lineHeight: 1 })));
    const gy = top + headH;
    els.push(rect({ x: b.x, y: gy, width: b.width, height: ch * weeks, fill: null, stroke: INK, strokeWidth: 0.8 }));
    for (let w = 1; w < weeks; w++) els.push(line({ x: b.x, y: gy + w * ch, width: b.width, height: 0, stroke: RULE, strokeWidth: 0.5 }));
    for (let k = 1; k < 7; k++) els.push(line({ x: b.x + k * cw, y: gy, width: 0, height: ch * weeks, stroke: RULE, strokeWidth: 0.5 }));
    cells.forEach((day, idx) => {
      if (day === null) return;
      const cx = b.x + (idx % 7) * cw;
      const cy = gy + Math.floor(idx / 7) * ch;
      els.push(text({ x: cx + 3, y: cy + 3, width: cw - 6, height: 9, text: String(day), fontSize: 8, color: "#444444" }));
    });
    const ny = gy + ch * weeks + 12;
    els.push(text({ x: b.x, y: ny, width: b.width, height: 12.5, text: "Notes", fontSize: 11, bold: true }));
    const sp = inToPt(0.28);
    const n = Math.floor((b.y + b.height - ny - 16) / sp);
    if (n > 0) els.push(lineBlock(ctx, ny + 16, n, sp));
    return page(ctx, "monthly-calendar", els, { label: month ? monthLabel(month) : undefined });
  });
}

function weeklyPages(ctx: Ctx, count: number, startDate: string): Page[] {
  const start = parseStart(startDate);
  return Array.from({ length: count }, (_, i) => {
    const b = ctx.box;
    const monday = start ? addDays(startOfWeek(start), i * 7) : null;
    const els: Element[] = [];
    if (monday) els.push(heading(ctx, `Week of ${shortDate(monday)}, ${monday.getUTCFullYear()}`, b.y, 16, SERIF));
    else els.push(...labelLine(ctx, "Week of:", b.x + b.width * 0.2, b.y + 16, b.width * 0.6, 12));
    const top = b.y + 34;
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
      els.push(text({ x: x + 6, y: y + 5, width: colW - 12, height: 11.3, text: `${label}${day}`, fontSize: 10, bold: true }));
      const sp = inToPt(0.25);
      const n = Math.floor((boxH - 24) / sp);
      if (n > 0) els.push(lineBlock(ctx, y + 20, n, sp, x + 6, colW - 12));
    });
    return page(ctx, "weekly-spread", els);
  });
}

/* --------------------------------- puzzles -------------------------------- */

const showPuzzles = (part?: PuzzlePart) => part !== "solutions";
const showSolutions = (cfg: { solutions: boolean; part?: PuzzlePart }) => cfg.solutions && cfg.part !== "puzzles";
/** Only self-contained ("all") sections get their own "Solutions" title page; grouped keys sit under one divider. */
const solutionsTitle = (ctx: Ctx, cfg: { part?: PuzzlePart }, kind: string): Page[] =>
  cfg.part === "solutions" ? [] : [page(ctx, kind, [heading(ctx, "Solutions", ctx.box.y + ctx.box.height * 0.4, 28, SERIF)], { label: "Solutions" })];

function sudokuGrid(ctx: Ctx, s: Sudoku, x: number, y: number, size: number, solution: boolean): Element[] {
  const cell = size / 9;
  const els: Element[] = [];
  const fs = cell * 0.55;
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    const given = s.puzzle[i] !== 0;
    if (given) els.push(cellText(x + c * cell, y + r * cell, cell, String(s.puzzle[i]), fs, { bold: true }));
    else if (solution) els.push(cellText(x + c * cell, y + r * cell, cell, String(s.solution[i]), fs, { color: "#7a7a7a" }));
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
  const label = cfg.difficulty[0].toUpperCase() + cfg.difficulty.slice(1);
  const pages: Page[] = [];
  const labelH = 22;
  if (showPuzzles(cfg.part))
    for (let p = 0; p < puzzles.length; p += cfg.perPage) {
      const els: Element[] = [];
      slots(ctx.box, cfg.perPage, labelH).forEach((slot, k) => {
        const s = puzzles[p + k];
        if (!s) return;
        els.push(text({ x: slot.x, y: slot.y - labelH + 2, width: slot.size, height: 13, text: `Puzzle #${first + p + k} · ${label}`, fontSize: 11, bold: true }));
        els.push(...sudokuGrid(ctx, s, slot.x, slot.y, slot.size, false));
      });
      pages.push(page(ctx, "sudoku", els, { generator: { kind: "sudoku", seed: cfg.seed, params: { difficulty: cfg.difficulty, from: first + p } } }));
    }
  if (showSolutions(cfg) && puzzles.length) {
    const per = 6;
    pages.push(...solutionsTitle(ctx, cfg, "sudoku-solutions"));
    for (let p = 0; p < puzzles.length; p += per) {
      const els: Element[] = [];
      const box = ctx.box;
      const cols = 2;
      const rows = 3;
      const gap = 16;
      const cw = (box.width - gap) / cols;
      const ch = (box.height - gap * (rows - 1)) / rows;
      const size = Math.min(cw, ch - 18);
      for (let k = 0; k < per; k++) {
        const s = puzzles[p + k];
        if (!s) break;
        const cx = box.x + (k % cols) * (cw + gap) + (cw - size) / 2;
        const cy = box.y + Math.floor(k / cols) * (ch + gap) + 18;
        els.push(text({ x: cx, y: cy - 16, width: size, height: 11, text: `Puzzle #${first + p + k}`, fontSize: 9, bold: true }));
        els.push(...sudokuGrid(ctx, s, cx, cy, size, true));
      }
      pages.push(page(ctx, "sudoku-solutions", els));
    }
  }
  return pages;
}

function wordSearchBlock(ws: WordSearch, x: number, y: number, size: number, solution: boolean): Element[] {
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
  ws.grid.forEach((row, r) => row.forEach((ch, c) => els.push(cellText(x + c * cell, y + r * cell, cell, ch, fs, { bold: !solution, family: SANS }))));
  els.push(rect({ x: x - 4, y: y - 4, width: size + 8, height: size + 8, fill: null, stroke: INK, strokeWidth: 1, cornerRadius: 6 }));
  return els;
}

function wordSearchPages(
  ctx: Ctx,
  cfg: { puzzles: { title: string; words: string[] }[]; size: number; difficulty: WordSearchDifficulty; aiRunId?: string } & PuzzleCommon,
  kind = "word-search",
  alphabet?: string,
): Page[] {
  const results = cfg.puzzles.map((p, i) => ({ title: p.title, ws: generateWordSearch(p.words, cfg.size, cfg.difficulty, cfg.seed + i, alphabet) }));
  const first = cfg.startNumber ?? 1;
  const prov: ArtifactProvenance | undefined = cfg.aiRunId ? { origin: "ai-generated", runId: cfg.aiRunId } : undefined;
  const pages: Page[] = !showPuzzles(cfg.part)
    ? []
    : results.map(({ title, ws }, i) => {
        const b = ctx.box;
        const titleEl = text({ x: b.x, y: b.y, width: b.width, height: 22, text: `${first + i}. ${title}`, fontSize: 18, bold: true, fontFamily: SERIF, align: "center" });
        const listRows = Math.ceil(ws.placed.length / 3);
        const listH = listRows * 15 + 10;
        const size = Math.min(b.width - 8, b.height - 40 - listH - 8);
        const gx = b.x + (b.width - size) / 2;
        const gy = b.y + 36;
        const els: Element[] = [prov ? tag(ctx, titleEl, prov) : titleEl, ...wordSearchBlock(ws, gx, gy, size, false)];
        const words = ws.placed.map((p) => p.word).sort();
        const colW = b.width / 3;
        words.forEach((w, k) => {
          const wordEl = text({ x: b.x + (k % 3) * colW, y: gy + size + 16 + Math.floor(k / 3) * 15, width: colW - 4, height: 11.3, text: w, fontSize: 10, align: "center" });
          els.push(prov ? tag(ctx, wordEl, prov) : wordEl);
        });
        return page(ctx, kind, els, { generator: { kind, seed: ws.seed, params: { size: cfg.size, difficulty: cfg.difficulty } } });
      });
  if (showSolutions(cfg) && results.length) {
    pages.push(...solutionsTitle(ctx, cfg, `${kind}-solutions`));
    for (let p = 0; p < results.length; p += 4) {
      const els: Element[] = [];
      slots(ctx.box, 4, 18).forEach((slot, k) => {
        const r = results[p + k];
        if (!r) return;
        els.push(text({ x: slot.x, y: slot.y - 18, width: slot.size, height: 11, text: `${first + p + k}. ${r.title}`, fontSize: 9, bold: true }));
        els.push(...wordSearchBlock(r.ws, slot.x + 4, slot.y + 4, slot.size - 8, true));
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
  const labelH = 40;
  const first = cfg.startNumber ?? 1;
  const cols = MAZE_SIZE[cfg.difficulty];
  const cell = (b.width - 8) / cols;
  const rows = Math.max(cols, Math.floor((b.height - labelH - 36) / cell));
  const mazes = Array.from({ length: cfg.count }, (_, i) => generateMaze(cols, rows, cfg.seed + i));
  const pages: Page[] = !showPuzzles(cfg.part)
    ? []
    : mazes.map((m, i) => {
        const w = m.cols * cell;
        const x = b.x + (b.width - w) / 2;
        const y = b.y + labelH;
        return page(
          ctx,
          "maze",
          [
            text({ x: b.x, y: b.y, width: b.width, height: 22, text: `Maze #${first + i}`, fontSize: 18, bold: true, fontFamily: SERIF, align: "center" }),
            text({ x: x - 10, y: y - 14, width: 60, height: 10, text: "START", fontSize: 8, bold: true }),
            ...mazeElements(m, x, y, cell, false),
            text({ x: x + w - 50, y: y + m.rows * cell + 4, width: 60, height: 10, text: "FINISH", fontSize: 8, bold: true, align: "right" }),
          ],
          { generator: { kind: "maze", seed: m.seed, params: { cols, rows } } },
        );
      });
  if (showSolutions(cfg) && mazes.length) {
    pages.push(...solutionsTitle(ctx, cfg, "maze-solutions"));
    for (let p = 0; p < mazes.length; p += 4) {
      const els: Element[] = [];
      slots(b, 4, 16).forEach((slot, k) => {
        const m = mazes[p + k];
        if (!m) return;
        const c = Math.min(slot.size / m.cols, slot.size / m.rows);
        els.push(text({ x: slot.x, y: slot.y - 16, width: slot.size, height: 11, text: `Maze #${first + p + k}`, fontSize: 9, bold: true }));
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
  return cfg.puzzles.map((p, i) => ({ title: p.title, items: scrambleWords(p.words, cfg.seed + i).slice(0, SCRAMBLE_MAX_WORDS) })).filter((s) => s.items.length);
}

function scramblePages(ctx: Ctx, cfg: Extract<GeneratorConfig, { kind: "word-scramble" }>): Page[] {
  const b = ctx.box;
  const first = cfg.startNumber ?? 1;
  const prov: ArtifactProvenance | undefined = cfg.aiRunId ? { origin: "ai-generated", runId: cfg.aiRunId } : undefined;
  const sets = scrambleSets(cfg);
  const pages: Page[] = [];
  if (showPuzzles(cfg.part))
    sets.forEach(({ title, items }, i) => {
      const titleEl = text({ x: b.x, y: b.y, width: b.width, height: 22, text: `${first + i}. ${title}`, fontSize: 18, bold: true, fontFamily: SERIF, align: "center" });
      const els: Element[] = [prov ? tag(ctx, titleEl, prov) : titleEl];
      els.push(text({ x: b.x, y: b.y + 28, width: b.width, height: 12, text: "Unscramble the letters to spell a word from the theme.", fontSize: 10, color: "#444444", align: "center" }));
      const top = b.y + 52;
      const rowH = Math.min(34, (b.height - 52) / items.length);
      const size = Math.min(15, rowH * 0.5);
      items.forEach((it, k) => {
        const y = top + k * rowH;
        const wordEl = text({ x: b.x, y, width: b.width * 0.48, height: size * 1.13, text: `${k + 1}.  ${it.scrambled.split("").join(" ")}`, fontSize: size, bold: true, fontFamily: "Roboto Mono" });
        els.push(prov ? tag(ctx, wordEl, prov) : wordEl);
        els.push(line({ x: b.x + b.width * 0.5, y: y + size * 1.13, width: b.width * 0.5, height: 0, stroke: RULE, strokeWidth: 0.6 }));
      });
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
        const size = Math.min(9, (rowH - 18) / (set.items.length * 1.13 * 1.18));
        els.push(text({ x, y, width: colW, height: 11, text: `${first + p + k}. ${set.title}`, fontSize: 9.5, bold: true }));
        const answers = set.items.map((it, n) => `${n + 1}. ${it.word}`).join("\n");
        els.push(text({ x, y: y + 16, width: colW, height: textBlockHeight(set.items.length, size, 1.18), text: answers, fontSize: size, lineHeight: 1.18 }));
      }
      pages.push(page(ctx, "word-scramble-solutions", els));
    }
  }
  return pages;
}

/** Hints per difficulty: easier puzzles reveal more of the most common letters. */
const CRYPTO_HINTS = { easy: 4, medium: 2, hard: 0 } as const;

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
  const emit = (solved: boolean, perPage: number, kind: string) => {
    const slotH = (b.height - (perPage - 1) * 24) / perPage;
    for (let p = 0; p < puzzles.length; p += perPage) {
      const els: Element[] = [];
      for (let k = 0; k < perPage; k++) {
        const c = puzzles[p + k];
        if (!c) break;
        const top = b.y + k * (slotH + 24);
        const hint = !solved && c.hints.length ? `  ·  Hint: ${c.hints.map((h) => `${c.key[h]} = ${h}`).join(", ")}` : "";
        els.push(text({ x: b.x, y: top, width: b.width, height: 14, text: `Cryptogram #${first + p + k}${hint}`, fontSize: solved ? 10 : 12, bold: true }));
        const block = cryptogramBlock(c, b.x, top + 26, b.width, slotH - 30, solved);
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

export function generatePages(cfg: GeneratorConfig, opts: GenerateOptions): Page[] {
  const g = interiorGeometry(opts.spec, opts.pageCountHint);
  const ctx: Ctx = {
    box: generatorBox(opts.spec, opts.pageCountHint),
    trimW: g.trimW,
    trimH: g.trimH,
    prov: { origin: "generated", generator: cfg.kind },
    assets: new Map((opts.assets ?? []).map((a) => [a.id, a])),
  };
  switch (cfg.kind) {
    case "blank":
      return Array.from({ length: cfg.count }, () => page(ctx, "blank", []));
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
    case "section-divider":
      return [sectionDivider(ctx, cfg.title, cfg.subtitle, cfg.aiRunId)];
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
    case "title-page":
    case "belongs-to":
    case "text-page":
    case "section-divider":
    case "table-of-contents":
      return 1;
    case "sudoku":
      return puzzlePages(cfg, cfg.count, Math.ceil(cfg.count / cfg.perPage), Math.ceil(cfg.count / 6));
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
    case "cryptogram": {
      const n = cfg.phrases.filter((t) => t.trim()).length;
      return puzzlePages(cfg, n, Math.ceil(n / cfg.perPage), Math.ceil(n / Math.max(cfg.perPage, 3)));
    }
    case "coloring":
      return cfg.assetIds.length * (cfg.blankBacks ? 2 : 1);
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
    case "cryptogram":
      return cfg.phrases.filter((t) => t.trim()).length;
    default:
      return 0;
  }
}
