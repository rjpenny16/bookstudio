import { createRng, shuffle, type Rng } from "./rng";
import { DIFFICULTY_AT, gradeSudoku, LEVELS_FOR, type SudokuLevel } from "./sudokuGrade";

/** 81 cells, row-major; 0 = empty. */
export type Grid = number[];

export type SudokuDifficulty = "easy" | "medium" | "hard" | "expert";

/** Typical number of givens per difficulty (difficulty itself is graded by technique, see sudokuGrade). */
export const SUDOKU_CLUES: Record<SudokuDifficulty, number> = { easy: 38, medium: 31, hard: 27, expert: 25 };

const ROW = (i: number) => Math.floor(i / 9);
const COL = (i: number) => i % 9;

function candidates(grid: Grid, i: number): number {
  let used = 0;
  const r = ROW(i);
  const c = COL(i);
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let k = 0; k < 9; k++) {
    used |= 1 << grid[r * 9 + k];
    used |= 1 << grid[k * 9 + c];
    used |= 1 << grid[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)];
  }
  return ~used & 0b1111111110;
}

function bitCount(n: number): number {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

/** Count solutions up to `limit` using MRV backtracking. */
export function countSolutions(input: Grid, limit = 2): number {
  const grid = input.slice();
  let count = 0;
  const solve = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue;
      const mask = candidates(grid, i);
      const n = bitCount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      count++;
      return count >= limit;
    }
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      grid[best] = d;
      if (solve()) return true;
    }
    grid[best] = 0;
    return false;
  };
  solve();
  return count;
}

export function solve(input: Grid): Grid | null {
  const grid = input.slice();
  const go = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) continue;
      const mask = candidates(grid, i);
      const n = bitCount(mask);
      if (n === 0) return false;
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
      }
    }
    if (best === -1) return true;
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      grid[best] = d;
      if (go()) return true;
    }
    grid[best] = 0;
    return false;
  };
  return go() ? grid : null;
}

function fullGrid(rng: Rng): Grid {
  const grid: Grid = new Array(81).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    const mask = candidates(grid, i);
    for (const d of shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (!(mask & (1 << d))) continue;
      grid[i] = d;
      if (fill(i + 1)) return true;
    }
    grid[i] = 0;
    return false;
  };
  fill(0);
  return grid;
}

export interface Sudoku {
  puzzle: Grid;
  solution: Grid;
  clues: number;
  /** The difficulty the puzzle actually grades at (see sudokuGrade), which is what its page says. */
  difficulty: SudokuDifficulty;
  /** Hardest technique level needed: 1 singles … 4 swordfish / XY-wing, 5 beyond those. */
  level: SudokuLevel;
  seed: number;
}

/** Removal stops here first; it continues toward CLUE_FLOOR only while the puzzle grades easier than wanted. */
const CLUE_START: Record<SudokuDifficulty, number> = { easy: 38, medium: 34, hard: 30, expert: 28 };
const CLUE_FLOOR: Record<SudokuDifficulty, number> = { easy: 34, medium: 26, hard: 23, expert: 20 };
const ATTEMPTS = 50;

/** Each symmetric pair of cells (and the center), in removal order. */
const pairOf = (i: number): number[] => (i === 40 ? [40] : [i, 80 - i]);

/**
 * A puzzle with exactly one solution that grades at `difficulty` by the
 * techniques a person needs (sudokuGrade). Clues are removed in symmetric
 * pairs; when a grid can't be brought to the wanted grade, another is
 * tried. If none get there, the closest easier one is returned, labelled
 * with the grade it really has.
 */
export function generateSudoku(seed: number, difficulty: SudokuDifficulty): Sudoku {
  const [lo, hi] = LEVELS_FOR[difficulty];
  let best: Sudoku | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const rng = createRng(seed + attempt * 7919);
    const solution = fullGrid(rng);
    const puzzle = solution.slice();
    let clues = 81;
    const order = shuffle(rng, Array.from({ length: 41 }, (_, k) => k));
    const tryRemove = (cells: number[]) => {
      const saved = cells.map((c) => puzzle[c]);
      cells.forEach((c) => (puzzle[c] = 0));
      if (countSolutions(puzzle, 2) === 1) {
        clues -= cells.length;
        return () => {
          cells.forEach((c, k) => (puzzle[c] = saved[k]));
          clues += cells.length;
        };
      }
      cells.forEach((c, k) => (puzzle[c] = saved[k]));
      return null;
    };
    // Down to the starting clue count, keeping the solution unique.
    const rest: number[] = [];
    for (const i of order) {
      const cells = pairOf(i);
      if (clues - cells.length < CLUE_START[difficulty] || !tryRemove(cells)) rest.push(i);
    }
    // Then further, one pair at a time, while it grades easier than wanted; a removal that overshoots is put back.
    let level = gradeSudoku(puzzle);
    for (const i of rest) {
      if (level >= lo) break;
      const cells = pairOf(i);
      if (puzzle[cells[0]] === 0 || clues - cells.length < CLUE_FLOOR[difficulty]) continue;
      const undo = tryRemove(cells);
      if (!undo) continue;
      const next = gradeSudoku(puzzle);
      if (next > hi) undo();
      else level = next;
    }
    const graded: Sudoku = { puzzle, solution, clues, difficulty: DIFFICULTY_AT[level], level, seed };
    if (level >= lo && level <= hi) return graded;
    // Otherwise keep the closest: easier than wanted beats harder, and among easier ones the hardest wins.
    const rank = (x: Sudoku) => (x.level > hi ? -1000 - x.level : x.level * 100 - x.clues);
    if (!best || rank(graded) > rank(best)) best = graded;
  }
  return best!;
}

export function isValidSolution(grid: Grid): boolean {
  if (grid.length !== 81 || grid.some((v) => v < 1 || v > 9)) return false;
  for (let k = 0; k < 9; k++) {
    const row = new Set<number>();
    const col = new Set<number>();
    const box = new Set<number>();
    for (let m = 0; m < 9; m++) {
      row.add(grid[k * 9 + m]);
      col.add(grid[m * 9 + k]);
      box.add(grid[(Math.floor(k / 3) * 3 + Math.floor(m / 3)) * 9 + (k % 3) * 3 + (m % 3)]);
    }
    if (row.size !== 9 || col.size !== 9 || box.size !== 9) return false;
  }
  return true;
}

