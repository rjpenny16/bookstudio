import { createRng, shuffle } from "./rng";
import { normalizeWord } from "./wordsearch";

export interface ScrambledWord {
  word: string;
  scrambled: string;
}

/**
 * Scramble each word so it never reads as the original. Words that cannot be
 * scrambled (fewer than 3 letters, or a single repeated letter) are dropped.
 */
export function scrambleWords(words: string[], seed: number): ScrambledWord[] {
  const rng = createRng(seed);
  const seen = new Set<string>();
  const out: ScrambledWord[] = [];
  for (const raw of words) {
    const word = normalizeWord(raw);
    if (word.length < 3 || seen.has(word) || new Set(word).size < 2) continue;
    seen.add(word);
    let scrambled = word;
    for (let tries = 0; tries < 20 && scrambled === word; tries++) scrambled = shuffle(rng, [...word]).join("");
    // A two-letter-type word like "ABAB" can shuffle back to itself every time; rotate as a last resort.
    if (scrambled === word) scrambled = word.slice(1) + word[0];
    out.push({ word, scrambled });
  }
  return out;
}
