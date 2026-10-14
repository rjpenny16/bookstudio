import { createRng, shuffle, type Rng } from "./rng";

export type WordSearchDifficulty = "easy" | "medium" | "hard";

const DIRS: Record<WordSearchDifficulty, [number, number][]> = {
  easy: [
    [0, 1],
    [1, 0],
  ],
  // Medium adds words read backwards along rows and columns; hard adds backwards diagonals too.
  medium: [
    [0, 1],
    [1, 0],
    [1, 1],
    [-1, 1],
    [0, -1],
    [-1, 0],
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
  /** Hidden message in the leftover squares, when one was asked for and fitted (letters only). */
  message?: string;
  /** Squares holding the message, in reading order. */
  messageCells?: [number, number][];
  /** The message is every `messageStep`-th leftover letter, so it is spread over the grid instead of reading in plain sight. */
  messageStep?: number;
}

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";

/** Uppercase and keep only characters of the grid alphabet (letters by default). */
export function normalizeWord(w: string, alphabet: string = LETTERS): string {
  return [...w.toUpperCase()].filter((ch) => alphabet.includes(ch)).join("");
}

/**
 * Place `word` at one of its legal spots. Easy grids keep words apart;
 * hard ones prefer spots that cross words already placed, so letters do
 * double duty and words hide inside each other.
 */
function tryPlace(rng: Rng, grid: string[][], word: string, dirs: [number, number][], difficulty: WordSearchDifficulty): PlacedWord | null {
  const size = grid.length;
  const attempts: { p: PlacedWord; overlap: number }[] = [];
  for (const [dr, dc] of dirs) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const er = r + dr * (word.length - 1);
        const ec = c + dc * (word.length - 1);
        if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
        let ok = true;
        let overlap = 0;
        for (let k = 0; k < word.length; k++) {
          const cell = grid[r + dr * k][c + dc * k];
          if (cell === word[k]) overlap++;
          else if (cell !== "") {
            ok = false;
            break;
          }
        }
        // A word lying entirely on top of another isn't a placement.
        if (ok && overlap < word.length) attempts.push({ p: { word, row: r, col: c, dr, dc }, overlap });
      }
    }
  }
  if (!attempts.length) return null;
  let pool = attempts;
  if (difficulty === "easy") {
    const min = Math.min(...attempts.map((a) => a.overlap));
    pool = attempts.filter((a) => a.overlap === min);
  } else if (difficulty === "hard" && rng() < 0.7) {
    const max = Math.max(...attempts.map((a) => a.overlap));
    if (max > 0) pool = attempts.filter((a) => a.overlap === max);
  }
  const pick = pool[Math.floor(rng() * pool.length)].p;
  for (let k = 0; k < pick.word.length; k++) grid[pick.row + pick.dr * k][pick.col + pick.dc * k] = pick.word[k];
  return pick;
}

const ALL_DIRS: [number, number][] = DIRS.hard;

/** Every place `word` can be read in the grid, in any of the eight directions (a palindrome reads twice from one spot). */
export function findReads(grid: string[][], word: string): PlacedWord[] {
  const size = grid.length;
  const out: PlacedWord[] = [];
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      for (const [dr, dc] of ALL_DIRS) {
        let k = 0;
        while (k < word.length && grid[r + dr * k]?.[c + dc * k] === word[k]) k++;
        if (k === word.length) out.push({ word, row: r, col: c, dr, dc });
      }
  return out;
}

const sameSpot = (a: PlacedWord, b: PlacedWord) =>
  (a.row === b.row && a.col === b.col && a.dr === b.dr && a.dc === b.dc) ||
  // The same cells read the other way (a palindrome).
  (a.row === b.row + b.dr * (b.word.length - 1) && a.col === b.col + b.dc * (b.word.length - 1) && a.dr === -b.dr && a.dc === -b.dc);

/** Placed words that can be read somewhere else in the grid too. */
export function doubleReads(ws: WordSearch): number {
  return ws.placed.filter((p) => findReads(ws.grid, p.word).some((x) => !sameSpot(x, p))).length;
}

/**
 * A word search where every listed word can be found exactly once. When a
 * second reading is made entirely of other words' letters (no filler to
 * change), the grid is laid out again; the first clean layout wins.
 *
 * With a `message`, the leftover squares spell it once every word is found,
 * the classic hidden-message puzzle: read row by row from the top left,
 * every `messageStep`-th leftover letter (2nd, 3rd or 4th, as the free
 * squares allow) is the next letter of the message. Spacing the letters
 * out keeps the message from reading in plain sight along the top rows.
 * A layout that leaves too few squares free is tried again.
 */
export function generateWordSearch(
  words: string[],
  size: number,
  difficulty: WordSearchDifficulty,
  seed: number,
  alphabet: string = LETTERS,
  message?: string,
): WordSearch {
  const hidden = message ? normalizeWord(message, alphabet) : "";
  let best: { ws: WordSearch; doubles: number } | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ws = layOut(words, size, difficulty, seed + attempt * 7919, alphabet, hidden);
    const doubles = doubleReads(ws) + (hidden && !ws.message ? 100 : 0);
    if (!doubles) return { ...ws, seed };
    if (!best || doubles < best.doubles || (doubles === best.doubles && ws.placed.length > best.ws.placed.length)) best = { ws, doubles };
  }
  return { ...best!.ws, seed };
}

function layOut(words: string[], size: number, difficulty: WordSearchDifficulty, seed: number, alphabet: string, message = ""): WordSearch {
  const rng = createRng(seed);
  const grid: string[][] = Array.from({ length: size }, () => Array<string>(size).fill(""));
  const norm = (w: string) => normalizeWord(w, alphabet);
  const fits = Array.from(new Set(words.map(norm).filter((w) => w.length >= 2 && w.length <= size)));
  // A word that reads inside another listed word, either way round (CAR in TRACTOR), could never be found just once.
  const hidden = (w: string) => fits.some((o) => o.length > w.length && (o.includes(w) || o.includes([...w].reverse().join(""))));
  const clean = fits.filter((w) => !hidden(w));
  // Longest first gives the best packing.
  const ordered = shuffle(rng, clean).sort((a, b) => b.length - a.length);
  const placed: PlacedWord[] = [];
  const skipped: string[] = words.filter((w) => {
    const n = norm(w);
    return n.length < 2 || n.length > size || hidden(n);
  });
  for (const word of ordered) {
    const p = tryPlace(rng, grid, word, DIRS[difficulty], difficulty);
    if (p) placed.push(p);
    else skipped.push(word);
  }
  // Filler: random letters on easy grids; on harder ones mostly letters from the words themselves, so stray fragments act as decoys.
  const pool = placed.map((p) => p.word).join("") || alphabet;
  const decoyShare = difficulty === "easy" ? 0 : difficulty === "medium" ? 0.5 : 0.8;
  const filler = () => (rng() < decoyShare ? pool[Math.floor(rng() * pool.length)] : alphabet[Math.floor(rng() * alphabet.length)]);
  const fixed = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  for (const p of placed) for (let k = 0; k < p.word.length; k++) fixed[p.row + p.dr * k][p.col + p.dc * k] = true;
  // The hidden message takes every step-th free square in reading order; filler goes in between and after.
  const free: [number, number][] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fixed[r][c]) free.push([r, c]);
  const step = message ? Math.max(1, Math.min(4, Math.floor(free.length / message.length))) : 1;
  const messageCells = message && free.length > message.length ? Array.from({ length: message.length }, (_, k) => free[(k + 1) * step - 1]) : [];
  messageCells.forEach(([r, c], k) => {
    grid[r][c] = message[k];
    fixed[r][c] = true;
  });
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fixed[r][c]) grid[r][c] = filler();
  // Every listed word must be findable exactly once: break up any extra reading the filler made.
  for (let round = 0; round < 40; round++) {
    let changed = false;
    for (const p of placed) {
      for (const extra of findReads(grid, p.word).filter((x) => !sameSpot(x, p))) {
        const free = Array.from({ length: p.word.length }, (_, k) => [extra.row + extra.dr * k, extra.col + extra.dc * k]).filter(([r, c]) => !fixed[r][c]);
        if (!free.length) continue;
        const [r, c] = free[Math.floor(rng() * free.length)];
        const old = grid[r][c];
        do grid[r][c] = alphabet[Math.floor(rng() * alphabet.length)];
        while (grid[r][c] === old && alphabet.length > 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { size, grid, placed, skipped, seed, ...(messageCells.length ? { message, messageCells, messageStep: step } : {}) };
}

/** The letters left over once every placed word is crossed out, in reading order (every `messageStep`-th is the hidden message). */
export function leftoverLetters(ws: WordSearch): string {
  const used = new Set<string>();
  for (const p of ws.placed) for (let k = 0; k < p.word.length; k++) used.add(`${p.row + p.dr * k},${p.col + p.dc * k}`);
  return ws.grid.flatMap((row, r) => row.filter((_, c) => !used.has(`${r},${c}`))).join("");
}

/** Check a placed word actually reads correctly in the grid. */
export function verifyPlacement(ws: WordSearch, p: PlacedWord): boolean {
  for (let k = 0; k < p.word.length; k++) if (ws.grid[p.row + p.dr * k]?.[p.col + p.dc * k] !== p.word[k]) return false;
  return true;
}
