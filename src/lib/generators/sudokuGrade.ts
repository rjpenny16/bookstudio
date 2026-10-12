import type { Grid, SudokuDifficulty } from "./sudoku";

/**
 * Grade a sudoku the way a person solves it: apply the simplest technique
 * that makes progress, over and over, and note the hardest one ever needed.
 *
 *   level 1  naked and hidden singles                            → easy
 *   level 2  naked pairs, pointing pairs, box/line reduction      → medium
 *   level 3  naked triples, hidden pairs and triples, X-wing      ┐
 *   level 4  swordfish, XY-wing                                   ┘ hard
 *   level 5  none of these finish it (chains and beyond)          → expert
 *
 * Clue counts alone don't measure this: a 26-clue puzzle can fall to
 * singles and a 32-clue one can need an X-wing. Puzzles always have exactly
 * one solution; expert ones just need techniques beyond this list.
 */

export type SudokuLevel = 1 | 2 | 3 | 4 | 5;

/** The technique levels each difficulty spans. */
export const LEVELS_FOR: Record<SudokuDifficulty, [SudokuLevel, SudokuLevel]> = { easy: [1, 1], medium: [2, 2], hard: [3, 4], expert: [5, 5] };
export const DIFFICULTY_AT: Record<SudokuLevel, SudokuDifficulty> = { 1: "easy", 2: "medium", 3: "hard", 4: "hard", 5: "expert" };

const ROWS = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c));
const COLS = Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c));
const BOXES = Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)));
const UNITS = [...ROWS, ...COLS, ...BOXES];
const ROW_OF = (i: number) => Math.floor(i / 9);
const COL_OF = (i: number) => i % 9;
const BOX_OF = (i: number) => Math.floor(ROW_OF(i) / 3) * 3 + Math.floor(COL_OF(i) / 3);
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set([...ROWS[ROW_OF(i)], ...COLS[COL_OF(i)], ...BOXES[BOX_OF(i)]]);
  s.delete(i);
  return [...s];
});
const sees = (a: number, b: number) => a !== b && (ROW_OF(a) === ROW_OF(b) || COL_OF(a) === COL_OF(b) || BOX_OF(a) === BOX_OF(b));

const ALL = 0b1111111110;
const bits = (m: number) => {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
};
const digitsOf = (m: number) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => m & (1 << d));

class Board {
  grid: number[];
  cand: number[];
  broken = false;
  constructor(puzzle: Grid) {
    this.grid = puzzle.slice();
    this.cand = this.grid.map((v) => (v ? 0 : ALL));
    for (let i = 0; i < 81; i++) if (this.grid[i]) for (const p of PEERS[i]) this.cand[p] &= ~(1 << this.grid[i]);
  }
  place(i: number, d: number) {
    this.grid[i] = d;
    this.cand[i] = 0;
    for (const p of PEERS[i]) this.cand[p] &= ~(1 << d);
  }
  /** Remove `mask` from cell `i`; true when something changed. */
  eliminate(i: number, mask: number): boolean {
    if (this.grid[i] || !(this.cand[i] & mask)) return false;
    this.cand[i] &= ~mask;
    if (!this.cand[i]) this.broken = true;
    return true;
  }
  solved() {
    return this.grid.every((v) => v);
  }
}

// ---- Level 1 -----------------------------------------------------------

function singles(b: Board): boolean {
  for (let i = 0; i < 81; i++) {
    if (!b.grid[i] && bits(b.cand[i]) === 1) {
      b.place(i, digitsOf(b.cand[i])[0]);
      return true;
    }
  }
  for (const unit of UNITS) {
    for (let d = 1; d <= 9; d++) {
      const where = unit.filter((i) => b.cand[i] & (1 << d));
      if (where.length === 1 && !unit.some((i) => b.grid[i] === d)) {
        b.place(where[0], d);
        return true;
      }
    }
  }
  return false;
}

// ---- Level 2 -----------------------------------------------------------

/** N cells of a unit whose candidates together are exactly N digits: those digits leave the unit's other cells. */
function nakedSubset(b: Board, n: number): boolean {
  for (const unit of UNITS) {
    const open = unit.filter((i) => !b.grid[i] && bits(b.cand[i]) <= n);
    for (const combo of combos(open, n)) {
      const mask = combo.reduce((m, i) => m | b.cand[i], 0);
      if (bits(mask) !== n) continue;
      let changed = false;
      for (const i of unit) if (!combo.includes(i)) changed = b.eliminate(i, mask) || changed;
      if (changed) return true;
    }
  }
  return false;
}

/** A digit confined to one row or column within a box leaves the rest of that line; confined to one box within a line, it leaves the rest of the box. */
function intersections(b: Board): boolean {
  for (let d = 1; d <= 9; d++) {
    const bit = 1 << d;
    for (const box of BOXES) {
      const where = box.filter((i) => b.cand[i] & bit);
      if (where.length < 2) continue;
      for (const [lineOf, lines] of [[ROW_OF, ROWS], [COL_OF, COLS]] as const) {
        if (where.every((i) => lineOf(i) === lineOf(where[0]))) {
          let changed = false;
          for (const i of lines[lineOf(where[0])]) if (!box.includes(i)) changed = b.eliminate(i, bit) || changed;
          if (changed) return true;
        }
      }
    }
    for (const line of [...ROWS, ...COLS]) {
      const where = line.filter((i) => b.cand[i] & bit);
      if (where.length < 2 || !where.every((i) => BOX_OF(i) === BOX_OF(where[0]))) continue;
      let changed = false;
      for (const i of BOXES[BOX_OF(where[0])]) if (!line.includes(i)) changed = b.eliminate(i, bit) || changed;
      if (changed) return true;
    }
  }
  return false;
}

// ---- Level 3 -----------------------------------------------------------

/** N digits that only fit in the same N cells of a unit: those cells lose every other candidate. */
function hiddenSubset(b: Board, n: number): boolean {
  for (const unit of UNITS) {
    const missing = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !unit.some((i) => b.grid[i] === d));
    for (const ds of combos(missing, n)) {
      const cells = new Set<number>();
      for (const d of ds) for (const i of unit) if (b.cand[i] & (1 << d)) cells.add(i);
      if (cells.size !== n) continue;
      const keep = ds.reduce((m, d) => m | (1 << d), 0);
      let changed = false;
      for (const i of cells) changed = b.eliminate(i, ~keep & ALL) || changed;
      if (changed) return true;
    }
  }
  return false;
}

/** X-wing (n = 2) and swordfish (n = 3): a digit confined to the same n columns in n rows leaves those columns elsewhere (and the same with rows and columns swapped). */
function fish(b: Board, n: number): boolean {
  for (let d = 1; d <= 9; d++) {
    const bit = 1 << d;
    for (const [base, cover, coverOf] of [[ROWS, COLS, COL_OF], [COLS, ROWS, ROW_OF]] as const) {
      const lines = base.map((line) => line.filter((i) => b.cand[i] & bit)).map((cells, k) => ({ k, cells })).filter((l) => l.cells.length >= 2 && l.cells.length <= n);
      for (const set of combos(lines, n)) {
        const covers = new Set(set.flatMap((l) => l.cells.map(coverOf)));
        if (covers.size !== n) continue;
        const inSet = new Set(set.flatMap((l) => l.cells));
        let changed = false;
        for (const c of covers) for (const i of cover[c]) if (!inSet.has(i)) changed = b.eliminate(i, bit) || changed;
        if (changed) return true;
      }
    }
  }
  return false;
}

// ---- Level 4 -----------------------------------------------------------

/** XY-wing: a two-candidate pivot XY seeing pincers XZ and YZ; Z leaves every cell that sees both pincers. */
function xyWing(b: Board): boolean {
  const pairs = Array.from({ length: 81 }, (_, i) => i).filter((i) => !b.grid[i] && bits(b.cand[i]) === 2);
  for (const pivot of pairs) {
    const [x, y] = digitsOf(b.cand[pivot]);
    const wings = pairs.filter((w) => w !== pivot && sees(pivot, w));
    for (const a of wings) {
      if (!(b.cand[a] & (1 << x)) || b.cand[a] & (1 << y)) continue;
      const z = digitsOf(b.cand[a] & ~(1 << x))[0];
      for (const c of wings) {
        if (c === a || b.cand[c] !== ((1 << y) | (1 << z))) continue;
        let changed = false;
        for (let i = 0; i < 81; i++) if (i !== pivot && sees(i, a) && sees(i, c)) changed = b.eliminate(i, 1 << z) || changed;
        if (changed) return true;
      }
    }
  }
  return false;
}

function combos<T>(items: T[], n: number): T[][] {
  if (n === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combos(items.slice(i + 1), n - 1)) out.push([item, ...rest]);
  });
  return out;
}

const STEPS: [SudokuLevel, (b: Board) => boolean, string][] = [
  [1, singles, "single"],
  [2, (b) => nakedSubset(b, 2), "naked pair"],
  [2, intersections, "intersection"],
  [3, (b) => nakedSubset(b, 3), "naked triple"],
  [3, (b) => hiddenSubset(b, 2), "hidden pair"],
  [3, (b) => hiddenSubset(b, 3), "hidden triple"],
  [3, (b) => fish(b, 2), "x-wing"],
  [4, (b) => fish(b, 3), "swordfish"],
  [4, xyWing, "xy-wing"],
];

/** Solve by logic alone: the grid as far as these techniques get, and the hardest level used (5 when they can't finish). */
export function solveByLogic(puzzle: Grid): { level: SudokuLevel; grid: Grid; uses: Partial<Record<string, number>> } {
  const b = new Board(puzzle);
  let level: SudokuLevel = 1;
  const uses: Partial<Record<string, number>> = {};
  for (let guard = 0; guard < 2000 && !b.solved(); guard++) {
    if (b.broken) return { level: 5, grid: b.grid, uses };
    const step = STEPS.find(([, fn]) => fn(b));
    if (!step) return { level: 5, grid: b.grid, uses };
    uses[step[2]] = (uses[step[2]] ?? 0) + 1;
    if (step[0] > level) level = step[0];
  }
  return { level: b.solved() && !b.broken ? level : 5, grid: b.grid, uses };
}

/** The hardest technique level needed to solve `puzzle` by logic, or 5 when these techniques can't finish it. */
export function gradeSudoku(puzzle: Grid): SudokuLevel {
  return solveByLogic(puzzle).level;
}
