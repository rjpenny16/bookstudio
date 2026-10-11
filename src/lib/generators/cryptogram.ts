import { createRng, shuffle } from "./rng";
import { LETTERS } from "./wordsearch";

export interface Cryptogram {
  /** Uppercased plaintext. */
  plain: string;
  cipher: string;
  /** plain letter -> cipher letter */
  key: Record<string, string>;
  /** Plain letters revealed as hints. */
  hints: string[];
  seed: number;
}

/** A substitution alphabet where no letter maps to itself (a derangement). */
export function derangedAlphabet(seed: number): Record<string, string> {
  const rng = createRng(seed);
  const letters = [...LETTERS];
  let perm = shuffle(rng, letters);
  for (let tries = 0; tries < 100 && perm.some((ch, i) => ch === letters[i]); tries++) perm = shuffle(rng, letters);
  // Fix any remaining fixed points by swapping with a neighbour (keeps it a permutation).
  for (let i = 0; i < perm.length; i++) {
    if (perm[i] === letters[i]) {
      const j = (i + 1) % perm.length;
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
  }
  return Object.fromEntries(letters.map((ch, i) => [ch, perm[i]]));
}

export function encrypt(plain: string, key: Record<string, string>): string {
  return [...plain.toUpperCase()].map((ch) => key[ch] ?? ch).join("");
}

export function decrypt(cipher: string, key: Record<string, string>): string {
  const inverse = Object.fromEntries(Object.entries(key).map(([p, c]) => [c, p]));
  return [...cipher].map((ch) => inverse[ch] ?? ch).join("");
}

/** Build a cryptogram, revealing the `hintCount` most frequent letters (easier puzzles reveal more). */
export function generateCryptogram(text: string, seed: number, hintCount: number): Cryptogram {
  const plain = text.toUpperCase().replace(/\s+/g, " ").trim();
  const key = derangedAlphabet(seed);
  const counts = new Map<string, number>();
  for (const ch of plain) if (LETTERS.includes(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const hints = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, hintCount))
    .map(([ch]) => ch);
  return { plain, cipher: encrypt(plain, key), key, hints, seed };
}
