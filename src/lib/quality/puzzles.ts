import { generateCryptogram } from "@/lib/generators/cryptogram";
import { generateMaze, type Maze } from "@/lib/generators/maze";
import { CRYPTO_HINTS, numberSearchLists, type GeneratorConfig } from "@/lib/generators/pages";
import { scrambleWords } from "@/lib/generators/scramble";
import { generateSudoku, SUDOKU_CLUES, type SudokuDifficulty } from "@/lib/generators/sudoku";
import { DIGITS, generateWordSearch, type WordSearch } from "@/lib/generators/wordsearch";
import type { Project } from "@/lib/schema/project";

/**
 * Measurements of the puzzles a book actually contains, recomputed from each
 * section's seed: how close sudoku clue counts land to their difficulty label,
 * which directions word-search words run, how long maze solutions are. The
 * sample harness reports them so changes to the generators can be compared
 * book by book. Nothing here judges pass or fail.
 */

export interface SudokuStats {
  difficulty: SudokuDifficulty;
  count: number;
  targetClues: number;
  minClues: number;
  avgClues: number;
  maxClues: number;
  /** Share of puzzles at or below the target clue count. */
  onTarget: number;
}

export interface WordSearchStats {
  kind: "word-search" | "number-search";
  difficulty: string;
  size: number;
  count: number;
  avgPlaced: number;
  skipped: number;
  /** Share of placed words by direction class. */
  directions: { forward: number; backward: number; diagonal: number };
  /** Placed words that can also be read a second time somewhere in their grid. */
  duplicateReads: number;
}

export interface MazeStats {
  difficulty: string;
  cols: number;
  rows: number;
  count: number;
  /** Solution path length divided by the number of cells. */
  avgSolutionShare: number;
  /** Share of cells with three walls. */
  avgDeadEndShare: number;
}

export interface ScrambleStats {
  count: number;
  words: number;
  /** Average share of letters left in their original position. */
  avgInPlace: number;
  /** Scrambles that spell another word from the same list. */
  anagramCollisions: number;
}

export interface CryptogramStats {
  difficulty: string;
  count: number;
  avgLetters: number;
  avgHints: number;
}

export interface PuzzleStats {
  sudoku: SudokuStats[];
  wordSearch: WordSearchStats[];
  maze: MazeStats[];
  scramble: ScrambleStats[];
  cryptogram: CryptogramStats[];
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const ALL_DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [-1, 1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [1, -1],
];

/** How many times a word can be read in the grid, in any of the eight directions. */
export function countReads(ws: WordSearch, word: string): number {
  let n = 0;
  const size = ws.size;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      for (const [dr, dc] of ALL_DIRS) {
        let k = 0;
        while (k < word.length && ws.grid[r + dr * k]?.[c + dc * k] === word[k]) k++;
        if (k === word.length) n++;
      }
  // A palindrome reads twice from one placement.
  return word === [...word].reverse().join("") ? n / 2 : n;
}

function wordSearchStats(kind: WordSearchStats["kind"], difficulty: string, size: number, grids: WordSearch[]): WordSearchStats {
  const dirs = { forward: 0, backward: 0, diagonal: 0 };
  let duplicateReads = 0;
  for (const ws of grids)
    for (const p of ws.placed) {
      if (p.dr !== 0 && p.dc !== 0) dirs.diagonal++;
      else if (p.dr < 0 || p.dc < 0) dirs.backward++;
      else dirs.forward++;
      if (countReads(ws, p.word) > 1) duplicateReads++;
    }
  const placed = dirs.forward + dirs.backward + dirs.diagonal || 1;
  return {
    kind,
    difficulty,
    size,
    count: grids.length,
    avgPlaced: round(avg(grids.map((g) => g.placed.length)), 1),
    skipped: grids.reduce((n, g) => n + g.skipped.length, 0),
    directions: { forward: round(dirs.forward / placed), backward: round(dirs.backward / placed), diagonal: round(dirs.diagonal / placed) },
    duplicateReads,
  };
}

function mazeShares(m: Maze): { solution: number; deadEnds: number } {
  const cells = m.cols * m.rows;
  let deadEnds = 0;
  for (const w of m.walls) if ([1, 2, 4, 8].filter((b) => w & b).length === 3) deadEnds++;
  return { solution: m.solution.length / cells, deadEnds: deadEnds / cells };
}

/** Answer-key sections repeat the puzzles of a body section, so only the puzzle half is measured. */
const isPuzzleHalf = (cfg: GeneratorConfig) => !("part" in cfg) || cfg.part !== "solutions";

export function puzzleStats(project: Project): PuzzleStats {
  const out: PuzzleStats = { sudoku: [], wordSearch: [], maze: [], scramble: [], cryptogram: [] };
  for (const section of project.interior.sections) {
    const cfg = section.config;
    if (!isPuzzleHalf(cfg)) continue;
    switch (cfg.kind) {
      case "sudoku": {
        const clues = Array.from({ length: cfg.count }, (_, i) => generateSudoku(cfg.seed + i, cfg.difficulty).clues);
        const target = SUDOKU_CLUES[cfg.difficulty];
        out.sudoku.push({
          difficulty: cfg.difficulty,
          count: cfg.count,
          targetClues: target,
          minClues: Math.min(...clues),
          avgClues: round(avg(clues), 1),
          maxClues: Math.max(...clues),
          onTarget: round(clues.filter((c) => c <= target).length / (clues.length || 1)),
        });
        break;
      }
      case "word-search": {
        const grids = cfg.puzzles.map((p, i) => generateWordSearch(p.words, cfg.size, cfg.difficulty, cfg.seed + i));
        out.wordSearch.push(wordSearchStats("word-search", cfg.difficulty, cfg.size, grids));
        break;
      }
      case "number-search": {
        const grids = numberSearchLists(cfg).map((p, i) => generateWordSearch(p.words, cfg.size, cfg.difficulty, cfg.seed + i, DIGITS));
        out.wordSearch.push(wordSearchStats("number-search", cfg.difficulty, cfg.size, grids));
        break;
      }
      case "maze": {
        // The grid size depends on the page box, so it is read from the pages the section produced.
        const page = project.interior.pages.find((p) => p.sectionId === section.id && p.generator?.kind === "maze");
        const params = page?.generator?.params as { cols?: number; rows?: number } | undefined;
        if (!params?.cols || !params.rows) break;
        const { cols, rows } = params;
        const shares = Array.from({ length: cfg.count }, (_, i) => mazeShares(generateMaze(cols, rows, cfg.seed + i)));
        out.maze.push({
          difficulty: cfg.difficulty,
          cols,
          rows,
          count: cfg.count,
          avgSolutionShare: round(avg(shares.map((s) => s.solution))),
          avgDeadEndShare: round(avg(shares.map((s) => s.deadEnds))),
        });
        break;
      }
      case "word-scramble": {
        const lists = cfg.puzzles.map((p, i) => scrambleWords(p.words, cfg.seed + i));
        const items = lists.flat();
        const inPlace = items.map((s) => [...s.word].filter((ch, k) => s.scrambled[k] === ch).length / s.word.length);
        const anagramCollisions = lists.reduce((n, list) => {
          const words = new Set(list.map((s) => s.word));
          return n + list.filter((s) => words.has(s.scrambled)).length;
        }, 0);
        out.scramble.push({ count: lists.length, words: items.length, avgInPlace: round(avg(inPlace)), anagramCollisions });
        break;
      }
      case "cryptogram": {
        const puzzles = cfg.phrases.map((t) => t.trim()).filter(Boolean).map((t, i) => generateCryptogram(t, cfg.seed + i, CRYPTO_HINTS[cfg.difficulty]));
        out.cryptogram.push({
          difficulty: cfg.difficulty,
          count: puzzles.length,
          avgLetters: round(avg(puzzles.map((p) => p.plain.replace(/[^A-Z]/g, "").length)), 1),
          avgHints: round(avg(puzzles.map((p) => p.hints.length)), 1),
        });
        break;
      }
    }
  }
  return out;
}
