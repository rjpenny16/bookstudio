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
