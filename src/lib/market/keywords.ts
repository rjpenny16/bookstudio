import { LISTING } from "@/lib/kdp/rules";
import { findProhibited } from "@/lib/metadata/validate";
import type { KeywordMetric } from "./types";

/**
 * Fills KDP's seven keyword slots from search phrases, most-searched first.
 * Amazon matches a search against the title, subtitle and every slot together,
 * so a word already in the title (or in an earlier slot) is never typed
 * again, and short phrases share a slot to use all 50 characters.
 */

export interface KeywordPack {
  slots: string[];
  /** Phrases the title, subtitle and slots already cover in full. */
  covered: string[];
  /** Phrases that didn't fit or aren't allowed, with why. */
  skipped: { keyword: string; why: string }[];
  /** The most-searched phrase with a known volume, if any. */
  top: KeywordMetric | null;
  /** Whether every word of `top` is in the title or subtitle. */
  topInTitle: boolean;
}

/** Words that don't need a slot: Amazon ignores them, or the format already says them. */
const FILLER = new Set(["a", "an", "and", "the", "for", "of", "to", "in", "on", "with", "by", "or", "&"]);

export const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9&'\s-]+/g, " ")
    .split(/[\s-]+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);

/** Highest volume first; phrases with no known volume keep their order after them. */
export function rankKeywords(candidates: KeywordMetric[]): KeywordMetric[] {
  const best = new Map<string, KeywordMetric & { i: number }>();
  candidates.forEach((c, i) => {
    const k = words(c.keyword).join(" ");
    if (!k) return;
    const prev = best.get(k);
    if (!prev) best.set(k, { ...c, keyword: k, i });
    else if ((c.volume ?? -1) > (prev.volume ?? -1)) best.set(k, { ...c, keyword: k, i: prev.i });
  });
  return [...best.values()].sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.i - b.i).map((m) => ({ keyword: m.keyword, volume: m.volume, source: m.source }));
}

/** True when every meaningful word of `phrase` is in `text`. */
export function coversPhrase(text: string, phrase: string): boolean {
  const have = new Set(words(text));
  return words(phrase).every((w) => FILLER.has(w) || have.has(w));
}

export function packKeywords(input: { title: string; subtitle: string; candidates: KeywordMetric[] }, maxSlots: number = LISTING.maxKeywords, maxChars: number = LISTING.maxKeywordChars): KeywordPack {
  const ranked = rankKeywords(input.candidates);
  const titleText = `${input.title} ${input.subtitle}`;
  const used = new Set(words(titleText));
  const slots: string[] = [];
  const covered: string[] = [];
  const skipped: KeywordPack["skipped"] = [];

  for (const c of ranked) {
    if (findProhibited(c.keyword).length) {
      skipped.push({ keyword: c.keyword, why: "contains a term KDP doesn't allow" });
      continue;
    }
    const fresh = [...new Set(words(c.keyword))].filter((w) => !FILLER.has(w) && !used.has(w));
    if (!fresh.length) {
      covered.push(c.keyword);
      continue;
    }
    const phrase = fresh.join(" ");
    if (phrase.length > maxChars) {
      skipped.push({ keyword: c.keyword, why: `longer than ${maxChars} characters` });
      continue;
    }
    const i = slots.findIndex((s) => s.length + 1 + phrase.length <= maxChars);
    if (i >= 0) slots[i] = `${slots[i]} ${phrase}`;
    else if (slots.length < maxSlots) slots.push(phrase);
    else {
      skipped.push({ keyword: c.keyword, why: "no room left in the keyword slots" });
      continue;
    }
    for (const w of fresh) used.add(w);
  }

  const top = ranked.find((c) => c.volume !== null) ?? null;
  return { slots, covered, skipped, top, topInTitle: top ? coversPhrase(titleText, top.keyword) : false };
}

/** Everything a book's slots could be filled from: measured phrases first, then the ones already in the listing and the brief. */
export function keywordCandidates(p: { metadata: { keywords: string[] }; brief: { keywordIdeas: string[] }; market?: { keywords: KeywordMetric[] } }): KeywordMetric[] {
  return [...(p.market?.keywords ?? []), ...p.metadata.keywords.map((k) => ({ keyword: k, volume: null, source: "listing" })), ...p.brief.keywordIdeas.map((k) => ({ keyword: k, volume: null, source: "brief" }))];
}
