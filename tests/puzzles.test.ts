import { describe, expect, it } from "vitest";
import { countSolutions, generateSudoku, isValidSolution } from "@/lib/generators/sudoku";
import { DIFFICULTY_AT, gradeSudoku, LEVELS_FOR, solveByLogic } from "@/lib/generators/sudokuGrade";
import { generateWordSearch, verifyPlacement } from "@/lib/generators/wordsearch";
import { generateMaze } from "@/lib/generators/maze";

describe("sudoku", () => {
  it.each(["easy", "medium", "hard", "expert"] as const)("generates unique %s puzzles labelled with the grade they really have", (difficulty) => {
    let onLabel = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = generateSudoku(seed * 101, difficulty);
      expect(isValidSolution(s.solution)).toBe(true);
      expect(countSolutions(s.puzzle, 2)).toBe(1);
      s.puzzle.forEach((v, i) => v && expect(v).toBe(s.solution[i]));
      expect(s.clues).toBe(s.puzzle.filter(Boolean).length);
      // The label always matches what solving it takes.
      expect(gradeSudoku(s.puzzle)).toBe(s.level);
      expect(DIFFICULTY_AT[s.level]).toBe(s.difficulty);
      if (s.difficulty === difficulty) onLabel++;
    }
    expect(onLabel).toBeGreaterThanOrEqual(5);
  });

  it("grades by technique, not clue count", () => {
    // Solvable with singles alone.
    const easy = generateSudoku(7, "easy");
    expect(solveByLogic(easy.puzzle)).toMatchObject({ level: 1 });
    expect(solveByLogic(easy.puzzle).grid).toEqual(easy.solution);
    // A medium puzzle needs a pair or intersection somewhere; singles alone stall.
    const medium = generateSudoku(7, "medium");
    const uses = solveByLogic(medium.puzzle).uses;
    expect((uses["naked pair"] ?? 0) + (uses["intersection"] ?? 0)).toBeGreaterThan(0);
    expect(LEVELS_FOR.hard).toEqual([3, 4]);
  });

  it("is deterministic per seed", () => {
    expect(generateSudoku(42, "medium").puzzle).toEqual(generateSudoku(42, "medium").puzzle);
    expect(generateSudoku(42, "medium").puzzle).not.toEqual(generateSudoku(43, "medium").puzzle);
  });
});

describe("word search", () => {
  const words = ["apple", "banana", "cherry", "grape", "lemon", "mango", "orange", "peach", "pear", "plum", "kiwi", "melon", "papaya", "guava"];
  it.each(["easy", "medium", "hard"] as const)("places every word readably (%s)", (difficulty) => {
    const ws = generateWordSearch(words, 15, difficulty, 7);
    expect(ws.placed.length).toBe(words.length);
    for (const p of ws.placed) expect(verifyPlacement(ws, p)).toBe(true);
    expect(ws.grid.flat().every((c) => /^[A-Z]$/.test(c))).toBe(true);
  });

  it("only uses allowed directions on easy", () => {
    const ws = generateWordSearch(words, 15, "easy", 3);
    for (const p of ws.placed) expect([[0, 1], [1, 0]]).toContainEqual([p.dr, p.dc]);
  });

  it("skips words that cannot fit", () => {
    const ws = generateWordSearch(["supercalifragilistic", "cat"], 10, "easy", 1);
    expect(ws.skipped).toContain("supercalifragilistic");
    expect(ws.placed.map((p) => p.word)).toEqual(["CAT"]);
  });
});

describe("maze", () => {
  it("is a perfect maze with a connected solution", () => {
    const m = generateMaze(12, 16, 99);
    // Entrance on the top row (left third), exit on the bottom row (right third).
    expect(m.start).toBeLessThan(4);
    expect(m.end).toBeGreaterThanOrEqual(12 * 15 + 8);
    expect(m.solution[0]).toBe(m.start);
    expect(m.solution[m.solution.length - 1]).toBe(m.end);
    expect(m.walls[m.start] & 1).toBe(0);
    expect(m.walls[m.end] & 4).toBe(0);
    // Count open internal passages: a perfect maze is a spanning tree (cells - 1 edges).
    let open = 0;
    for (let i = 0; i < m.walls.length; i++) {
      if (i % m.cols < m.cols - 1 && !(m.walls[i] & 2)) open++;
      if (Math.floor(i / m.cols) < m.rows - 1 && !(m.walls[i] & 4)) open++;
    }
    expect(open).toBe(m.cols * m.rows - 1);
    for (let k = 1; k < m.solution.length; k++) {
      const a = m.solution[k - 1];
      const b = m.solution[k];
      expect([1, m.cols]).toContain(Math.abs(a - b));
    }
  });
});
