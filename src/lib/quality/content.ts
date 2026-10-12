import type { GeneratorConfig } from "@/lib/generators/pages";
import { normalizeWord } from "@/lib/generators/wordsearch";

/**
 * Deterministic content checks for model-written (or hand-written) book
 * content: journal prompts, word lists, cryptogram sayings and affirmations.
 * The `clean*` functions repair what can be repaired without a model (drop
 * duplicates and unusable items); the `check*` functions report what a person
 * or a second model call should look at.
 */

export type Severity = "high" | "medium" | "low";

export interface ContentIssue {
  severity: Severity;
  message: string;
  /** The item the issue is about, when there is one. */
  item?: string;
}

// ---------------------------------------------------------------------------
// Text similarity

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its just me my of on or our so than that the their them then there these they this to up was we were what when where which who why will with would you your yours".split(" "),
);

/** Content words, lightly stemmed, so "moments that made you smile" ≈ "a moment that made you smile". */
export function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, "") || w);
}

const normalizeText = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** True when two short texts say the same thing in nearly the same words. */
export function nearDuplicate(a: string, b: string): boolean {
  if (normalizeText(a) === normalizeText(b)) return true;
  const wa = new Set(contentWords(a));
  const wb = new Set(contentWords(b));
  if (wa.size < 2 || wb.size < 2) return false;
  const small = wa.size <= wb.size ? wa : wb;
  const large = small === wa ? wb : wa;
  // One is the other plus a word or two ("What made you smile?" / "What made you smile today?").
  if (small.size >= 3 && [...small].every((w) => large.has(w)) && large.size - small.size <= 2) return true;
  return jaccard(wa, wb) >= 0.7;
}

/** The first two words, lowercased: "What is…", "I am…". Used to keep a section's openings varied. */
export const openerKey = (s: string) => normalizeText(s).split(" ").slice(0, 2).join(" ");

/** A low-severity issue when more than `share` of `items` open the same way. */
function monotony(items: string[], what: string, share: number): ContentIssue[] {
  if (items.length < 12) return [];
  const openers = new Map<string, number>();
  for (const p of items) openers.set(openerKey(p), (openers.get(openerKey(p)) ?? 0) + 1);
  const [top, n] = [...openers.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return n / items.length > share ? [{ severity: "low", message: `${n} of ${items.length} ${what} start with "${top}…"; vary the openings` }] : [];
}

/** Index of the first earlier item `s` duplicates, or -1. */
function findDuplicate(s: string, earlier: string[]): number {
  return earlier.findIndex((e) => nearDuplicate(s, e));
}

// ---------------------------------------------------------------------------
// Journal prompts

const CLOSED_START = /^(do|does|did|are|is|was|were|have|has|had|can|could|will|would|should)\s+(you|i|your|it|there)\b/i;

/** Strip list numbering, bullets and wrapping quotes a model sometimes adds. */
export function tidyLine(s: string): string {
  return s
    .trim()
    .replace(/^(\d+[.)]|[-*•])\s+/, "")
    .replace(/^["“](.*)["”]$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function promptProblems(p: string): ContentIssue[] {
  const out: ContentIssue[] = [];
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length < 4) out.push({ severity: "medium", message: "Too short to guide writing", item: p });
  if (p.length > 160) out.push({ severity: "low", message: "Longer than 160 characters; may crowd the page", item: p });
  if (CLOSED_START.test(p) && !/\b(why|how|what|describe|which|when)\b/i.test(p.split(/[?.]/).slice(1).join(" ")))
    out.push({ severity: "low", message: "Yes/no question; open questions get more written", item: p });
  if (/[[\]{}<>]|lorem ipsum|\bTODO\b/i.test(p)) out.push({ severity: "high", message: "Contains placeholder text", item: p });
  return out;
}

export interface CleanResult {
  kept: string[];
  dropped: { item: string; reason: string }[];
}

/**
 * Tidy prompts and drop the unusable ones: empty, placeholder text, and exact
 * or near duplicates of each other or of `seen` (prompts used elsewhere in the
 * book). Weak-but-usable prompts are kept and reported by `checkPrompts`.
 */
export function cleanPrompts(prompts: string[], seen: string[] = []): CleanResult {
  const kept: string[] = [];
  const dropped: CleanResult["dropped"] = [];
  for (const raw of prompts) {
    const p = tidyLine(raw);
    if (!p) continue;
    if (p.length > 220 || promptProblems(p).some((i) => i.severity === "high")) {
      dropped.push({ item: p, reason: "unusable" });
      continue;
    }
    if (findDuplicate(p, kept) >= 0 || findDuplicate(p, seen) >= 0) {
      dropped.push({ item: p, reason: "duplicate" });
      continue;
    }
    kept.push(p);
  }
  return { kept, dropped };
}

export function checkPrompts(prompts: string[]): ContentIssue[] {
  const issues: ContentIssue[] = [];
  prompts.forEach((p, i) => {
    const dup = findDuplicate(p, prompts.slice(0, i));
    if (dup >= 0) issues.push({ severity: "high", message: `Repeats prompt ${dup + 1}${normalizeText(p) === normalizeText(prompts[dup]) ? "" : " in other words"}`, item: p });
    else issues.push(...promptProblems(p));
  });
  // Monotony: too many prompts open the same way ("What is…", "What is…").
  issues.push(...monotony(prompts, "prompts", 0.35));
  return issues;
}

// ---------------------------------------------------------------------------
// Word lists (word search, word scramble)

// Words a family puzzle book should never contain. Kept short and unambiguous on purpose.
const BLOCKED = new Set(["DAMN", "HELL", "CRAP", "SEXY", "SEX", "KILL", "DRUNK", "BOOZE", "STUPID", "IDIOT", "DUMB", "UGLY", "FAT", "HATE", "GUN", "BLOOD", "DRUGS", "BEER", "VODKA", "WHISKEY", "CASINO"]);

export interface WordListOptions {
  /** Longest word the grid can hold. */
  maxLength: number;
  minLength?: number;
  /** Scrambles need words whose letters can be rearranged into something else. */
  scramble?: boolean;
}

function isPluralOf(a: string, b: string): boolean {
  return a === `${b}S` || a === `${b}ES` || (b.endsWith("Y") && a === `${b.slice(0, -1)}IES`);
}

/** Why a word can't be used in a puzzle, or null. */
function wordProblem(raw: string, w: string, o: WordListOptions): string | null {
  if (!w) return "no letters";
  if (/[^A-Za-z\s'-]/.test(raw.trim())) return "not plain letters";
  if (w.length < (o.minLength ?? 3)) return "too short";
  if (w.length > o.maxLength) return `longer than ${o.maxLength} letters`;
  if (BLOCKED.has(w)) return "not family-friendly";
  if (o.scramble && new Set(w).size < 2) return "can't be scrambled";
  return null;
}

/** True when `word` can be read inside the longer `other`, forwards or backwards. */
export const hidesIn = (word: string, other: string) => other.length > word.length && (other.includes(word) || other.includes([...word].reverse().join("")));

/**
 * Normalize a word list and drop words that would weaken the puzzle:
 * unusable words, duplicates, singular/plural pairs, and words hidden inside a
 * longer word of the same list (finding SUN inside SUNFLOWER is ambiguous).
 */
export function cleanWordList(words: string[], o: WordListOptions): CleanResult {
  const dropped: CleanResult["dropped"] = [];
  const norm: { raw: string; w: string }[] = [];
  for (const raw of words) {
    const w = normalizeWord(raw);
    const problem = wordProblem(raw, w, o);
    if (problem) {
      dropped.push({ item: raw, reason: problem });
      continue;
    }
    if (norm.some((n) => n.w === w || isPluralOf(n.w, w) || isPluralOf(w, n.w))) {
      dropped.push({ item: raw, reason: "duplicate" });
      continue;
    }
    norm.push({ raw: raw.trim(), w });
  }
  // Drop the shorter word of any pair where one hides inside the other, forwards or backwards (word search only: CAR reads backwards in TRACTOR).
  const kept: string[] = [];
  for (const n of norm) {
    if (!o.scramble && norm.some((m) => hidesIn(n.w, m.w))) dropped.push({ item: n.raw, reason: "hidden inside a longer word" });
    else kept.push(n.w);
  }
  return { kept, dropped };
}

export interface CrosswordEntry {
  answer: string;
  clue: string;
}

/** True when the clue gives the answer away: the answer, its plural, or a word built on it (SUN in "Sunflower seeds"). */
export function clueGivesAway(clue: string, answer: string): boolean {
  const a = normalizeWord(answer);
  return (clue.toUpperCase().match(/[A-Z]+/g) ?? []).some((w) => {
    const [short, long] = w.length <= a.length ? [w, a] : [a, w];
    return w === a || isPluralOf(w, a) || isPluralOf(a, w) || (long.startsWith(short) && short.length >= (short === a ? 3 : 4));
  });
}

const CLUE_MAX = 90;

/**
 * Normalize a crossword's entries and drop the ones that would spoil it:
 * unusable answers, repeats and plural pairs, missing or overlong clues, and
 * clues that contain their answer.
 */
export function cleanCrossword(entries: CrosswordEntry[], maxLength: number): { kept: CrosswordEntry[]; dropped: CleanResult["dropped"] } {
  const dropped: CleanResult["dropped"] = [];
  const kept: CrosswordEntry[] = [];
  for (const e of entries) {
    const answer = normalizeWord(e.answer ?? "");
    const clue = (e.clue ?? "").trim().replace(/\s+/g, " ");
    const problem = wordProblem(e.answer ?? "", answer, { maxLength }) ?? (!clue ? "no clue" : clue.length > CLUE_MAX ? "clue too long" : clueGivesAway(clue, answer) ? "clue gives the answer away" : null);
    if (problem) dropped.push({ item: e.answer, reason: problem });
    else if (kept.some((k) => k.answer === answer || isPluralOf(k.answer, answer) || isPluralOf(answer, k.answer))) dropped.push({ item: e.answer, reason: "duplicate" });
    else kept.push({ answer, clue });
  }
  return { kept, dropped };
}

export function checkWordList(title: string, words: string[], o: WordListOptions & { target?: number }): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const { kept, dropped } = cleanWordList(words, o);
  for (const d of dropped) issues.push({ severity: d.reason === "not family-friendly" ? "high" : "medium", message: `"${title}": ${d.item} (${d.reason})`, item: d.item });
  const min = Math.max(6, Math.floor((o.target ?? 10) * 0.6));
  if (kept.length < min) issues.push({ severity: "high", message: `"${title}" has only ${kept.length} usable word(s)` });
  return issues;
}

/** Share of `a`'s words that also appear in `b`. */
function overlap(a: string[], b: string[]): number {
  if (!a.length) return 0;
  const sb = new Set(b);
  return a.filter((w) => sb.has(w)).length / a.length;
}

/** Puzzles that repeat an earlier puzzle's title or most of its words. Returns indexes into `puzzles`. */
export function repeatedPuzzles(puzzles: { title: string; words: string[] }[], seenTitles: string[] = []): { index: number; reason: string }[] {
  const out: { index: number; reason: string }[] = [];
  const titles = seenTitles.map(normalizeText);
  const lists: string[][] = [];
  puzzles.forEach((p, i) => {
    const words = p.words.map((w) => normalizeWord(w));
    const t = normalizeText(p.title);
    const sameTitle = t && titles.includes(t);
    const similar = lists.findIndex((l) => overlap(words, l) >= 0.5);
    if (sameTitle) out.push({ index: i, reason: `title "${p.title}" is used twice` });
    else if (similar >= 0) out.push({ index: i, reason: `shares most words with "${puzzles[similar]?.title ?? "an earlier puzzle"}"` });
    titles.push(t);
    lists.push(words);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sayings (cryptograms) and affirmations

const letters = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

export function phraseProblems(p: string, style: "saying" | "affirmation", maxLength: number): ContentIssue[] {
  const out: ContentIssue[] = [];
  if (p.length > maxLength) out.push({ severity: "medium", message: `Longer than ${maxLength} characters`, item: p });
  if (/["“”]|\s[-–—]\s*[A-Z][a-z]+(\s[A-Z][a-z]+)*\.?$/.test(p)) out.push({ severity: "high", message: "Looks like an attributed quotation; use original sayings", item: p });
  if (style === "saying") {
    const l = letters(p);
    if (l.length < 15) out.push({ severity: "low", message: "Very short; gives solvers little to work with", item: p });
    else if (new Set(l).size < 8) out.push({ severity: "low", message: "Uses few distinct letters", item: p });
  } else if (!/\b(i|i'm|i’m|my|me|myself)\b/i.test(p)) {
    out.push({ severity: "low", message: "Affirmations read best in the first person", item: p });
  }
  return out;
}

export function cleanPhrases(phrases: string[], style: "saying" | "affirmation", maxLength: number, seen: string[] = []): CleanResult {
  const kept: string[] = [];
  const dropped: CleanResult["dropped"] = [];
  for (const raw of phrases) {
    const p = tidyLine(raw);
    if (!p) continue;
    const bad = phraseProblems(p, style, maxLength).find((i) => i.severity !== "low");
    if (bad) {
      dropped.push({ item: p, reason: bad.message.toLowerCase() });
      continue;
    }
    if (findDuplicate(p, kept) >= 0 || findDuplicate(p, seen) >= 0) {
      dropped.push({ item: p, reason: "duplicate" });
      continue;
    }
    kept.push(p);
  }
  return { kept, dropped };
}

export function checkPhrases(phrases: string[], style: "saying" | "affirmation", maxLength: number): ContentIssue[] {
  const issues: ContentIssue[] = [];
  phrases.forEach((p, i) => {
    const dup = findDuplicate(p, phrases.slice(0, i));
    if (dup >= 0) issues.push({ severity: style === "saying" ? "high" : "medium", message: `Repeats ${style === "saying" ? "saying" : "affirmation"} ${dup + 1}`, item: p });
    else issues.push(...phraseProblems(p, style, maxLength));
  });
  if (style === "affirmation") issues.push(...monotony(phrases, "affirmations", 0.4));
  return issues;
}

// ---------------------------------------------------------------------------
// Section-level checks

/** Longest word that fits a word-search grid of `size` (matches the planner). */
export const wordSearchMaxLength = (size: number) => Math.min(12, size - 2);
export const CRYPTOGRAM_MAX = (perPage: 1 | 2) => (perPage === 2 ? 90 : 120);

/** Issues in one generator config's content. Cross-section repeats are found by `checkBookContent`. */
export function checkSectionContent(cfg: GeneratorConfig): ContentIssue[] {
  switch (cfg.kind) {
    case "journal-prompts":
      return checkPrompts(cfg.prompts);
    case "word-search":
    case "word-scramble": {
      const o: WordListOptions = cfg.kind === "word-search" ? { maxLength: wordSearchMaxLength(cfg.size) } : { maxLength: 10, scramble: true };
      const issues = cfg.puzzles.flatMap((p) => checkWordList(p.title, p.words, { ...o, target: cfg.kind === "word-search" ? (cfg.size <= 12 ? 10 : cfg.size <= 15 ? 15 : 18) : 12 }));
      for (const r of repeatedPuzzles(cfg.puzzles)) issues.push({ severity: "medium", message: `Puzzle "${cfg.puzzles[r.index].title}" ${r.reason}` });
      return issues;
    }
    case "crossword": {
      const issues: ContentIssue[] = [];
      for (const p of cfg.puzzles) {
        const { kept, dropped } = cleanCrossword(p.entries, cfg.size);
        for (const d of dropped) issues.push({ severity: d.reason === "not family-friendly" ? "high" : "medium", message: `"${p.title}": ${d.item} (${d.reason})`, item: d.item });
        if (kept.length < 6) issues.push({ severity: "high", message: `"${p.title}" has only ${kept.length} usable answer(s)` });
      }
      const lists = cfg.puzzles.map((p) => ({ title: p.title, words: p.entries.map((e) => e.answer) }));
      for (const r of repeatedPuzzles(lists)) issues.push({ severity: "medium", message: `Puzzle "${lists[r.index].title}" ${r.reason}` });
      return issues;
    }
    case "cryptogram":
      return checkPhrases(cfg.phrases, "saying", CRYPTOGRAM_MAX(cfg.perPage));
    case "gratitude": {
      const issues = checkPhrases(cfg.affirmations ?? [], "affirmation", 90);
      const n = cfg.affirmations?.length ?? 0;
      // Pages cycle through the list; a reader notices a repeat within a few weeks.
      if (n && n < cfg.count) issues.push({ severity: "low", message: `${n} affirmations for ${cfg.count} pages; ${cfg.count - n} page(s) repeat one` });
      return issues;
    }
    default:
      return [];
  }
}

/** Text items of a config that must not repeat across the whole book. */
export function sectionTexts(cfg: GeneratorConfig): { kind: "prompt" | "saying" | "affirmation" | "puzzle"; items: string[] } | null {
  if (cfg.kind === "journal-prompts") return { kind: "prompt", items: cfg.prompts };
  if (cfg.kind === "cryptogram") return { kind: "saying", items: cfg.phrases };
  if (cfg.kind === "gratitude") return { kind: "affirmation", items: cfg.affirmations ?? [] };
  if (cfg.kind === "word-search" || cfg.kind === "word-scramble" || cfg.kind === "crossword") return { kind: "puzzle", items: cfg.puzzles.map((p) => p.title) };
  return null;
}

/**
 * Check every content section of a book, including repeats between sections
 * (the same prompt in two journal sections, the same saying in two
 * cryptogram sections). Answer-key passes of a puzzle section are skipped.
 */
export function checkBookContent(sections: { id: string; label: string; config: GeneratorConfig }[]): { sectionId: string; label: string; issues: ContentIssue[] }[] {
  const out: { sectionId: string; label: string; issues: ContentIssue[] }[] = [];
  const seen: Record<string, { text: string; label: string }[]> = {};
  for (const s of sections) {
    if ("part" in s.config && s.config.part === "solutions") continue;
    const issues = checkSectionContent(s.config);
    const texts = sectionTexts(s.config);
    if (texts && texts.kind !== "puzzle") {
      const earlier = seen[texts.kind] ?? (seen[texts.kind] = []);
      const own: { text: string; label: string }[] = [];
      for (const t of texts.items) {
        const dup = earlier.find((e) => nearDuplicate(t, e.text));
        if (dup) issues.push({ severity: "high", message: `Also used in "${dup.label}"`, item: t });
        own.push({ text: t, label: s.label });
      }
      earlier.push(...own);
    }
    if (issues.length) out.push({ sectionId: s.id, label: s.label, issues });
  }
  return out;
}
