import { describe, expect, it } from "vitest";
import { countSolutions, generateSudoku, isValidSolution, SUDOKU_CLUES } from "@/lib/generators/sudoku";
import { generateWordSearch, verifyPlacement } from "@/lib/generators/wordsearch";
import { generateMaze } from "@/lib/generators/maze";

describe("sudoku", () => {
  it.each(["easy", "medium", "hard"] as const)("generates unique %s puzzles", (difficulty) => {
    for (let seed = 1; seed <= 5; seed++) {
      const s = generateSudoku(seed * 101, difficulty);
      expect(isValidSolution(s.solution)).toBe(true);
      expect(countSolutions(s.puzzle, 2)).toBe(1);
      s.puzzle.forEach((v, i) => v && expect(v).toBe(s.solution[i]));
      expect(s.clues).toBeGreaterThanOrEqual(SUDOKU_CLUES[difficulty]);
      expect(s.clues).toBeLessThanOrEqual(SUDOKU_CLUES[difficulty] + 6);
    }
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
    expect(m.solution[0]).toBe(0);
    expect(m.solution[m.solution.length - 1]).toBe(12 * 16 - 1);
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
