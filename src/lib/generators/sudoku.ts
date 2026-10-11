import { createRng, shuffle, type Rng } from "./rng";

/** 81 cells, row-major; 0 = empty. */
export type Grid = number[];

export type SudokuDifficulty = "easy" | "medium" | "hard" | "expert";

/** Target number of givens per difficulty. Every puzzle has exactly one solution. */
export const SUDOKU_CLUES: Record<SudokuDifficulty, number> = { easy: 40, medium: 32, hard: 27, expert: 24 };

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
  difficulty: SudokuDifficulty;
  seed: number;
}

export function generateSudoku(seed: number, difficulty: SudokuDifficulty): Sudoku {
  const rng = createRng(seed);
  const solution = fullGrid(rng);
  const puzzle = solution.slice();
  const target = SUDOKU_CLUES[difficulty];
  let clues = 81;
  // Remove cells in symmetric pairs while the solution stays unique.
  for (const i of shuffle(rng, Array.from({ length: 41 }, (_, k) => k))) {
    if (clues <= target) break;
    const j = 80 - i;
    const removed = i === j ? 1 : 2;
    if (clues - removed < target) continue;
    const saved = [puzzle[i], puzzle[j]];
    puzzle[i] = 0;
    puzzle[j] = 0;
    if (countSolutions(puzzle, 2) !== 1) {
      puzzle[i] = saved[0];
      puzzle[j] = saved[1];
    } else {
      clues -= removed;
    }
  }
  return { puzzle, solution, clues, difficulty, seed };
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

