import { createRng, shuffle, type Rng } from "./rng";

/**
 * Themed crosswords in the free-form ("criss-cross") style of puzzle books:
 * the theme's answers interlock on a grid, unused squares stay open, and
 * every answer crosses at least one other. Layout is seeded and checked: no
 * two answers touch side by side, none runs into another end to end, and
 * every across or down run of two or more letters is a listed answer.
 */

export type CrosswordDifficulty = "easy" | "medium" | "hard";

export interface CrosswordEntry {
  answer: string;
  clue: string;
}

export interface PlacedWord {
  answer: string;
  clue: string;
  row: number;
  col: number;
  dir: "across" | "down";
  number: number;
}

export interface Crossword {
  rows: number;
  cols: number;
  /** Letters, null for open squares. */
  grid: (string | null)[][];
  /** Placed answers in clue order (across first, then down, by number). */
  words: PlacedWord[];
  /** Answers that couldn't be fitted. */
  skipped: string[];
  seed: number;
}

/** Layouts tried per puzzle until one places every answer; the best is kept. */
const ATTEMPTS = 60;

/** How strongly a layout prefers crossings over a small footprint: harder puzzles interlock more. */
const CROSS_WEIGHT: Record<CrosswordDifficulty, number> = { easy: 6, medium: 10, hard: 16 };

export const normalizeAnswer = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

interface Cell {
  ch: string;
  /** 1 = part of an across answer, 2 = part of a down answer. */
  dirs: number;
}

interface Layout {
  cells: Map<string, Cell>;
  placed: { entry: CrosswordEntry; row: number; col: number; dir: "across" | "down" }[];
  skipped: string[];
  crossings: number;
}

const key = (r: number, c: number) => `${r},${c}`;

/** Bounding box of the filled cells. */
function bounds(cells: Map<string, Cell>): { r0: number; r1: number; c0: number; c1: number } {
  let r0 = Infinity;
  let r1 = -Infinity;
  let c0 = Infinity;
  let c1 = -Infinity;
  for (const k of cells.keys()) {
    const [r, c] = k.split(",").map(Number);
    r0 = Math.min(r0, r);
    r1 = Math.max(r1, r);
    c0 = Math.min(c0, c);
    c1 = Math.max(c1, c);
  }
  return { r0, r1, c0, c1 };
}

/**
 * Crossings when `word` goes at (row, col) in `dir`, or -1 when it can't:
 * a clash with another letter, a square already used in the same direction,
 * a letter touching a neighbouring answer side by side, or an answer running
 * straight on into another.
 */
function fit(cells: Map<string, Cell>, word: string, row: number, col: number, dir: "across" | "down", max: number, b: ReturnType<typeof bounds> | null): number {
  const [dr, dc] = dir === "across" ? [0, 1] : [1, 0];
  const bit = dir === "across" ? 1 : 2;
  // The grid can't grow past `max` squares either way.
  if (b) {
    const r1 = row + dr * (word.length - 1);
    const c1 = col + dc * (word.length - 1);
    if (Math.max(b.r1, r1) - Math.min(b.r0, row) + 1 > max || Math.max(b.c1, c1) - Math.min(b.c0, col) + 1 > max) return -1;
  }
  if (cells.has(key(row - dr, col - dc)) || cells.has(key(row + dr * word.length, col + dc * word.length))) return -1;
  let crossings = 0;
  for (let k = 0; k < word.length; k++) {
    const r = row + dr * k;
    const c = col + dc * k;
    const cell = cells.get(key(r, c));
    if (cell) {
      if (cell.ch !== word[k] || cell.dirs & bit) return -1;
      crossings++;
      continue;
    }
    // A new letter may not sit beside another answer's letter.
    if (cells.has(key(r + dc, c + dr)) || cells.has(key(r - dc, c - dr))) return -1;
  }
  return crossings;
}

function put(layout: Layout, entry: CrosswordEntry, row: number, col: number, dir: "across" | "down", crossings: number) {
  const word = entry.answer;
  const [dr, dc] = dir === "across" ? [0, 1] : [1, 0];
  for (let k = 0; k < word.length; k++) {
    const kk = key(row + dr * k, col + dc * k);
    const cell = layout.cells.get(kk);
    if (cell) cell.dirs |= dir === "across" ? 1 : 2;
    else layout.cells.set(kk, { ch: word[k], dirs: dir === "across" ? 1 : 2 });
  }
  layout.placed.push({ entry, row, col, dir });
  layout.crossings += crossings;
}

function layOut(entries: CrosswordEntry[], max: number, difficulty: CrosswordDifficulty, rng: Rng, early: Set<string>): Layout {
  const layout: Layout = { cells: new Map(), placed: [], skipped: [], crossings: 0 };
  // Longest answers first gives the others the most to cross; ties are shuffled so attempts differ.
  // Answers an earlier attempt couldn't fit go right after the first, while the grid is still open.
  const order = shuffle(rng, entries).sort((a, b) => Number(early.has(b.answer)) - Number(early.has(a.answer)) || b.answer.length - a.answer.length);
  const first = order.splice(Math.floor(rng() * Math.min(3, order.length)), 1)[0];
  put(layout, first, 0, 0, rng() < 0.5 ? "across" : "down", 0);
  let pending = order;
  // Answers that fit nowhere yet get another chance once more of the grid is laid.
  for (let pass = 0; pass < entries.length && pending.length; pass++) {
    const left: CrosswordEntry[] = [];
    for (const entry of pending) {
      const word = entry.answer;
      const b = bounds(layout.cells);
      let best: { row: number; col: number; dir: "across" | "down"; score: number; crossings: number } | null = null;
      for (const [k, cell] of layout.cells) {
        const [r, c] = k.split(",").map(Number);
        for (let i = 0; i < word.length; i++) {
          if (word[i] !== cell.ch) continue;
          for (const dir of ["across", "down"] as const) {
            const row = dir === "across" ? r : r - i;
            const col = dir === "across" ? c - i : c;
            const crossings = fit(layout.cells, word, row, col, dir, max, b);
            if (crossings < 1) continue;
            // Prefer crossings, then a small, square-ish footprint.
            const r1 = Math.max(b.r1, row + (dir === "down" ? word.length - 1 : 0));
            const c1 = Math.max(b.c1, col + (dir === "across" ? word.length - 1 : 0));
            const h = r1 - Math.min(b.r0, row) + 1;
            const w = c1 - Math.min(b.c0, col) + 1;
            const score = crossings * CROSS_WEIGHT[difficulty] - h * w * 0.08 - Math.abs(h - w) * 0.6 + rng() * 2;
            if (!best || score > best.score) best = { row, col, dir, score, crossings };
          }
        }
      }
      if (best) put(layout, entry, best.row, best.col, best.dir, best.crossings);
      else left.push(entry);
    }
    if (left.length === pending.length) {
      pending = left;
      break;
    }
    pending = left;
  }
  layout.skipped = pending.map((e) => e.answer);
  return layout;
}

/** Number the placed answers the standard way: squares that start an answer, left to right, top to bottom. */
function finish(layout: Layout, seed: number): Crossword {
  const b = bounds(layout.cells);
  const rows = b.r1 - b.r0 + 1;
  const cols = b.c1 - b.c0 + 1;
  const grid: (string | null)[][] = Array.from({ length: rows }, () => Array<string | null>(cols).fill(null));
  for (const [k, cell] of layout.cells) {
    const [r, c] = k.split(",").map(Number);
    grid[r - b.r0][c - b.c0] = cell.ch;
  }
  const starts = layout.placed.map((p) => ({ ...p, row: p.row - b.r0, col: p.col - b.c0 }));
  const numbers = new Map<string, number>();
  [...starts]
    .sort((a, z) => a.row - z.row || a.col - z.col)
    .forEach((p) => {
      if (!numbers.has(key(p.row, p.col))) numbers.set(key(p.row, p.col), numbers.size + 1);
    });
  const words: PlacedWord[] = starts
    .map((p) => ({ answer: p.entry.answer, clue: p.entry.clue, row: p.row, col: p.col, dir: p.dir, number: numbers.get(key(p.row, p.col))! }))
    .sort((a, z) => (a.dir === z.dir ? a.number - z.number : a.dir === "across" ? -1 : 1));
  return { rows, cols, grid, words, skipped: layout.skipped, seed };
}

/**
 * A crossword of up to `maxSize` x `maxSize` squares from the theme's
 * entries. Answers are reduced to letters A-Z; repeats and answers shorter
 * than 3 or longer than the grid are dropped. Of `ATTEMPTS` seeded layouts,
 * the one that places the most answers wins, then the most crossings, then
 * the smallest footprint.
 */
export function generateCrossword(entries: CrosswordEntry[], maxSize: number, difficulty: CrosswordDifficulty, seed: number): Crossword {
  const seen = new Set<string>();
  const clean: CrosswordEntry[] = [];
  for (const e of entries) {
    const answer = normalizeAnswer(e.answer);
    if (answer.length < 3 || answer.length > maxSize || seen.has(answer) || !e.clue.trim()) continue;
    seen.add(answer);
    clean.push({ answer, clue: e.clue.trim() });
  }
  if (!clean.length) return { rows: 0, cols: 0, grid: [], words: [], skipped: [], seed };
  const rng = createRng(seed);
  let best: { layout: Layout; score: number } | null = null;
  const early = new Set<string>();
  // A few complete layouts are compared for the most crossings and the smallest footprint.
  let complete = 0;
  for (let a = 0; a < ATTEMPTS && complete < 8; a++) {
    const layout = layOut(clean, maxSize, difficulty, rng, early);
    const b = bounds(layout.cells);
    const area = (b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1);
    const score = layout.placed.length * 1000 + layout.crossings * 20 - area;
    if (!best || score > best.score) best = { layout, score };
    if (!layout.skipped.length) complete++;
    for (const s of layout.skipped) early.add(s);
  }
  return finish(best!.layout, seed);
}

/** Every across and down run of two or more letters, as text (for checking that only listed answers appear). */
export function gridRuns(cw: Crossword): string[] {
  const runs: string[] = [];
  const scan = (get: (i: number, j: number) => string | null, n: number, m: number) => {
    for (let i = 0; i < n; i++) {
      let run = "";
      for (let j = 0; j <= m; j++) {
        const ch = j < m ? get(i, j) : null;
        if (ch) run += ch;
        else {
          if (run.length > 1) runs.push(run);
          run = "";
        }
      }
    }
  };
  scan((r, c) => cw.grid[r][c], cw.rows, cw.cols);
  scan((c, r) => cw.grid[r][c], cw.cols, cw.rows);
  return runs;
}

/** Share of letter squares that belong to two answers. */
export function crossingShare(cw: Crossword): number {
  const letters = cw.grid.flat().filter(Boolean).length;
  const total = cw.words.reduce((n, w) => n + w.answer.length, 0);
  return letters ? (total - letters) / letters : 0;
}
