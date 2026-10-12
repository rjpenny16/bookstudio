import { describe, expect, it } from "vitest";
import { generateWordSearch, type WordSearch } from "@/lib/generators/wordsearch";
import { countReads, puzzleStats } from "@/lib/quality/puzzles";
import { createProject } from "@/lib/schema/factory";

const grid = (rows: string[]): WordSearch => ({ size: rows.length, grid: rows.map((r) => [...r]), placed: [], skipped: [], seed: 0 });

describe("countReads", () => {
  it("counts every direction, including backwards", () => {
    expect(countReads(grid(["CATX", "XXXX", "XXXX", "TACX"]), "CAT")).toBe(2);
    expect(countReads(grid(["CXXX", "XAXX", "XXTX", "XXXX"]), "CAT")).toBe(1);
  });

  it("counts a palindrome once per placement", () => {
    expect(countReads(grid(["ABAX", "XXXX", "XXXX", "XXXX"]), "ABA")).toBe(1);
  });
});

describe("puzzleStats", () => {
  const words = ["apple", "banana", "cherry", "grape", "lemon", "mango", "orange", "peach", "pear", "plum", "kiwi", "melon"];
  const project = createProject({
    name: "Stats",
    bookType: "puzzle",
    trimId: "8.5x11",
    paper: "white",
    ink: "black",
    bleed: false,
    author: "A",
    interior: [
      { kind: "sudoku", count: 3, difficulty: "easy", perPage: 1, solutions: false, seed: 5 },
      { kind: "word-search", puzzles: [{ title: "Fruit", words }], size: 15, difficulty: "hard", solutions: false, seed: 2 },
      { kind: "maze", count: 2, difficulty: "easy", solutions: false, seed: 9 },
      { kind: "word-scramble", puzzles: [{ title: "Fruit", words }], solutions: false, seed: 4 },
      { kind: "cryptogram", phrases: ["Slow and steady wins the race"], difficulty: "medium", perPage: 1, solutions: false, seed: 1 },
    ],
  });
  const stats = puzzleStats(project);

  it("measures how many sudoku puzzles grade at their label", () => {
    expect(stats.sudoku).toHaveLength(1);
    const s = stats.sudoku[0];
    expect(s).toMatchObject({ difficulty: "easy", count: 3, onGrade: 1, grades: { easy: 3 } });
    expect(s.minClues).toBeLessThanOrEqual(s.avgClues);
    expect(s.avgClues).toBeLessThanOrEqual(s.maxClues);
  });

  it("classifies word-search directions from the same grid the page shows", () => {
    const ws = generateWordSearch(words, 15, "hard", 2);
    const w = stats.wordSearch[0];
    expect(w.avgPlaced).toBe(ws.placed.length);
    const d = w.directions;
    expect(d.forward + d.backward + d.diagonal).toBeCloseTo(1, 2);
  });

  it("reads maze size from the pages and reports path and dead-end shares", () => {
    const m = stats.maze[0];
    expect(m.cols).toBe(10);
    expect(m.rows).toBeGreaterThanOrEqual(10);
    expect(m.avgSolutionShare).toBeGreaterThan(0);
    expect(m.avgSolutionShare).toBeLessThanOrEqual(1);
    expect(m.avgDeadEndShare).toBeGreaterThan(0);
  });

  it("reports scrambles and cryptograms", () => {
    expect(stats.scramble[0].words).toBe(words.length);
    expect(stats.cryptogram[0]).toMatchObject({ difficulty: "medium", count: 1, avgHints: 2 });
  });

  it("skips answer-key sections so puzzles are not counted twice", () => {
    const withKey = createProject({
      name: "Key",
      bookType: "puzzle",
      trimId: "6x9",
      paper: "white",
      ink: "black",
      bleed: false,
      author: "A",
      interior: [
        { kind: "sudoku", count: 2, difficulty: "medium", perPage: 1, solutions: true, part: "puzzles", seed: 3 },
        { kind: "sudoku", count: 2, difficulty: "medium", perPage: 1, solutions: true, part: "solutions", seed: 3 },
      ],
    });
    expect(puzzleStats(withKey).sudoku).toHaveLength(1);
  });
});
