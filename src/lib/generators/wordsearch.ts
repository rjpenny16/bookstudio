import { createRng, shuffle, type Rng } from "./rng";

export type WordSearchDifficulty = "easy" | "medium" | "hard";

const DIRS: Record<WordSearchDifficulty, [number, number][]> = {
  easy: [
    [0, 1],
    [1, 0],
  ],
  medium: [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
  ],
  hard: [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1],
  ],
};

export interface PlacedWord {
  word: string;
  row: number;
  col: number;
  dr: number;
  dc: number;
}

export interface WordSearch {
  size: number;
  grid: string[][];
  placed: PlacedWord[];
  skipped: string[];
  seed: number;
}

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";

/** Uppercase and keep only characters of the grid alphabet (letters by default). */
export function normalizeWord(w: string, alphabet: string = LETTERS): string {
  return [...w.toUpperCase()].filter((ch) => alphabet.includes(ch)).join("");
}

function tryPlace(rng: Rng, grid: string[][], word: string, dirs: [number, number][]): PlacedWord | null {
  const size = grid.length;
  const attempts: PlacedWord[] = [];
  for (const [dr, dc] of dirs) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const er = r + dr * (word.length - 1);
        const ec = c + dc * (word.length - 1);
        if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
        let ok = true;
        for (let k = 0; k < word.length; k++) {
          const cell = grid[r + dr * k][c + dc * k];
          if (cell !== "" && cell !== word[k]) {
            ok = false;
            break;
          }
        }
        if (ok) attempts.push({ word, row: r, col: c, dr, dc });
      }
    }
  }
  if (!attempts.length) return null;
  const pick = attempts[Math.floor(rng() * attempts.length)];
  for (let k = 0; k < word.length; k++) grid[pick.row + pick.dr * k][pick.col + pick.dc * k] = word[k];
  return pick;
}

export function generateWordSearch(
  words: string[],
  size: number,
  difficulty: WordSearchDifficulty,
  seed: number,
  alphabet: string = LETTERS,
): WordSearch {
  const rng = createRng(seed);
  const grid: string[][] = Array.from({ length: size }, () => Array<string>(size).fill(""));
  const norm = (w: string) => normalizeWord(w, alphabet);
  const clean = Array.from(new Set(words.map(norm).filter((w) => w.length >= 2 && w.length <= size)));
  // Longest first gives the best packing.
  const ordered = shuffle(rng, clean).sort((a, b) => b.length - a.length);
  const placed: PlacedWord[] = [];
  const skipped: string[] = words.filter((w) => {
    const n = norm(w);
    return n.length < 2 || n.length > size;
  });
  for (const word of ordered) {
    const p = tryPlace(rng, grid, word, DIRS[difficulty]);
    if (p) placed.push(p);
    else skipped.push(word);
  }
  for (const row of grid) for (let c = 0; c < size; c++) if (row[c] === "") row[c] = alphabet[Math.floor(rng() * alphabet.length)];
  return { size, grid, placed, skipped, seed };
}

/** Check a placed word actually reads correctly in the grid. */
export function verifyPlacement(ws: WordSearch, p: PlacedWord): boolean {
  for (let k = 0; k < p.word.length; k++) if (ws.grid[p.row + p.dr * k]?.[p.col + p.dc * k] !== p.word[k]) return false;
  return true;
}
