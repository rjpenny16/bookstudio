import { createRng, shuffle } from "./rng";
import { normalizeWord } from "./wordsearch";

export interface ScrambledWord {
  word: string;
  scrambled: string;
}

export type ScrambleDifficulty = "easy" | "medium" | "hard";

/**
 * Scramble each word so it never reads as the original or as another word
 * in the list. Easy keeps the first letter in place as a hint; medium leaves
 * at most 40% of letters where they were; hard moves every letter it can.
 * Words that cannot be scrambled (fewer than 3 letters, or a single repeated
 * letter) are dropped.
 */
export function scrambleWords(words: string[], seed: number, difficulty: ScrambleDifficulty = "medium"): ScrambledWord[] {
  const rng = createRng(seed);
  const seen = new Set<string>();
  const list = new Set(words.map((w) => normalizeWord(w)));
  const out: ScrambledWord[] = [];
  for (const raw of words) {
    const word = normalizeWord(raw);
    if (word.length < 3 || seen.has(word) || new Set(word).size < 2) continue;
    seen.add(word);
    const inPlace = (s: string) => [...s].filter((ch, k) => word[k] === ch).length;
    const allowed = difficulty === "easy" ? word.length : difficulty === "medium" ? Math.floor(word.length * 0.4) : 0;
    const shuffleOnce = () => (difficulty === "easy" ? word[0] + shuffle(rng, [...word.slice(1)]).join("") : shuffle(rng, [...word]).join(""));
    let best = word;
    let bestScore = Infinity;
    for (let tries = 0; tries < 60; tries++) {
      const s = shuffleOnce();
      if (s === word || list.has(s)) continue;
      // Fewest letters left in place wins, within what the difficulty allows; easy just needs a real shuffle.
      const score = difficulty === "easy" ? 0 : inPlace(s);
      if (score < bestScore) {
        best = s;
        bestScore = score;
      }
      if (score <= allowed && (difficulty !== "hard" || score === 0)) break;
    }
    // A two-letter-type word like "ABAB" can shuffle back to itself every time; rotate as a last resort.
    if (best === word) best = word.slice(1) + word[0];
    out.push({ word, scrambled: best });
  }
  return out;
}

/**
 * Order a word list so a secret word can be read down it: word k holds the
 * secret's k-th letter, at `marks[k]`. The secret's words go first, in
 * order, and the rest follow. Returns null when the words can't spell it
 * (a letter none of the unused words has). Words a scramble would drop
 * (repeats, fewer than 3 letters) are left out first, so the order holds.
 */
export function secretOrder(words: string[], secret: string): { words: string[]; marks: number[] } | null {
  const target = normalizeWord(secret);
  const usable: string[] = [];
  for (const raw of words) {
    const w = normalizeWord(raw);
    if (w.length >= 3 && new Set(w).size >= 2 && !usable.includes(w)) usable.push(w);
  }
  if (!target || target.length > usable.length) return null;
  // Rarest letters first, so a common letter doesn't take the only word with a Z; small lists, so a plain search is quick.
  const order = [...target].map((ch, k) => ({ ch, k })).sort((a, b) => usable.filter((w) => w.includes(a.ch)).length - usable.filter((w) => w.includes(b.ch)).length);
  const pick: number[] = new Array(target.length).fill(-1);
  const taken = new Set<number>();
  const assign = (i: number): boolean => {
    if (i === order.length) return true;
    const { ch, k } = order[i];
    for (let w = 0; w < usable.length; w++) {
      if (taken.has(w) || !usable[w].includes(ch)) continue;
      taken.add(w);
      pick[k] = w;
      if (assign(i + 1)) return true;
      taken.delete(w);
    }
    return false;
  };
  if (!assign(0)) return null;
  const chosen = pick.map((w) => usable[w]);
  // The marked square is the letter's middle-most occurrence, so it isn't always the first letter (easy scrambles keep that in place).
  const marks = chosen.map((w, k) => {
    const at = [...w].map((c, i) => (c === target[k] ? i : -1)).filter((i) => i >= 0);
    return at.find((i) => i > 0) ?? at[0];
  });
  return { words: [...chosen, ...usable.filter((_, w) => !taken.has(w))], marks };
}
