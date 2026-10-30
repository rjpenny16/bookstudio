import { matchCategory, suggestCategories } from "@/lib/kdp/categories";
import { LISTING } from "@/lib/kdp/rules";
import { packKeywords } from "@/lib/market/keywords";
import type { KeywordMetric } from "@/lib/market/types";
import type { BookType, ListingMetadata } from "@/lib/schema/project";
import type { Severity } from "./content";

/**
 * Rule-based listing critique. It works offline and runs alongside the model
 * critique: these are the things a careful KDP publisher checks before
 * pressing Publish (keyword stuffing, a description that never says what is
 * inside, categories that do not exist or do not fit the book).
 */

export type ListingField = "title" | "subtitle" | "description" | "keywords" | "categories" | "price";

export interface ListingNote {
  field: ListingField;
  severity: Severity;
  issue: string;
  suggestion: string;
}

export interface ListingFacts {
  bookType: BookType;
  topic: string;
  audience: string;
  pageCount: number;
  /** Measured search phrases for the book's niche, when there is market data. */
  searchTerms?: KeywordMetric[];
}

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

export function critiqueListingRules(m: ListingMetadata, facts: ListingFacts): ListingNote[] {
  const notes: ListingNote[] = [];
  const title = m.title.trim();
  const sub = m.subtitle.trim();

  // Title & subtitle
  if (title && title === title.toUpperCase() && /[A-Z]{4}/.test(title)) notes.push({ field: "title", severity: "medium", issue: "Title is in all capitals.", suggestion: "Use title case; KDP may ask you to match the cover and all caps reads as shouting in search results." });
  if (title.split(/\s+/).length > 12) notes.push({ field: "title", severity: "medium", issue: "Title is very long.", suggestion: "Keep the title short and memorable and move detail into the subtitle." });
  const counts = new Map<string, number>();
  for (const w of tokens(`${title} ${sub}`)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const stuffed = [...counts.entries()].filter(([w, n]) => n >= 3 && !["the", "and", "for", "with"].includes(w)).map(([w]) => w);
  if (stuffed.length) notes.push({ field: "subtitle", severity: "high", issue: `"${stuffed.join('", "')}" appears 3+ times in the title and subtitle.`, suggestion: "KDP treats repeated search terms in the title as keyword stuffing. Say it once and use the keyword slots for variations." });
  if (/\b\d+\s*(pages|pgs)\b|\b\d+(\.\d+)?\s*(x|by)\s*\d+(\.\d+)?\b/i.test(sub)) notes.push({ field: "subtitle", severity: "low", issue: "Subtitle lists the page count or trim size.", suggestion: "Amazon already shows these in the product details; use the subtitle to say who the book is for and what it helps them do." });
  if (facts.searchTerms?.length) {
    const { top, topInTitle } = packKeywords({ title, subtitle: sub, candidates: facts.searchTerms });
    if (top && !topInTitle) notes.push({ field: "title", severity: "medium", issue: `The most-searched phrase, "${top.keyword}" (${top.volume?.toLocaleString("en-US")} searches a month), isn't in the title or subtitle.`, suggestion: "Amazon weighs title words most; work the phrase into the subtitle if it doesn't suit the title." });
  }
  if (!sub) notes.push({ field: "subtitle", severity: "low", issue: "No subtitle.", suggestion: "A subtitle that names the audience and the main benefit helps both search and conversion." });

  // Description
  const d = m.description.trim();
  if (d) {
    if (d.length < 400) notes.push({ field: "description", severity: "medium", issue: `Description is short (${d.length} characters).`, suggestion: "Describe what is inside, who it is for and how it is laid out; 600-1500 characters works well." });
    if (!new RegExp(`\\b${facts.pageCount}\\b`).test(d) && !/\b\d{2,3}\b/.test(d)) notes.push({ field: "description", severity: "medium", issue: "Description never gives a number (pages, puzzles, prompts).", suggestion: `Buyers want specifics: say how many pages or puzzles (${facts.pageCount} pages).` });
    if (!/\n\s*[•\-*]/.test(d) && d.length > 300) notes.push({ field: "description", severity: "low", issue: "Description is one block of text.", suggestion: "Break out what's inside as a short bulleted list so it scans on a phone." });
    if (title && d.toLowerCase().startsWith(title.toLowerCase())) notes.push({ field: "description", severity: "low", issue: "Description opens by repeating the title.", suggestion: "Open with the reader's problem or the payoff instead; the title is already above it." });
    if (/\b(review|reviews|rate this|5 stars?|five stars?)\b/i.test(d)) notes.push({ field: "description", severity: "high", issue: "Description asks for reviews or ratings.", suggestion: "Remove it; KDP does not allow soliciting reviews in the listing." });
  }

  // Keywords
  const kws = m.keywords.map((k) => k.trim()).filter(Boolean);
  if (kws.length && kws.length < LISTING.maxKeywords) notes.push({ field: "keywords", severity: "medium", issue: `${LISTING.maxKeywords - kws.length} keyword slot(s) unused.`, suggestion: "Fill every slot with a different buyer search phrase." });
  const short = kws.filter((k) => k.split(/\s+/).length === 1);
  if (short.length >= 3) notes.push({ field: "keywords", severity: "low", issue: `${short.length} keywords are single words.`, suggestion: "Multi-word phrases that match how buyers search (\"large print sudoku for seniors\") work better than single words." });
  const head = new Map<string, number>();
  for (const k of kws) for (const w of new Set(tokens(k))) head.set(w, (head.get(w) ?? 0) + 1);
  const everywhere = [...head.entries()].filter(([, n]) => kws.length >= 5 && n >= kws.length - 1).map(([w]) => w);
  if (everywhere.length) notes.push({ field: "keywords", severity: "low", issue: `"${everywhere.join('", "')}" is in nearly every keyword.`, suggestion: "Amazon combines words across slots, so repeating one word wastes characters. Use the space for other angles: audience, occasion, use case." });
  if (kws.some((k) => /\b(book|paperback|notebook|journal)\b/i.test(k) && k.split(/\s+/).length <= 2)) notes.push({ field: "keywords", severity: "low", issue: "Some keywords are just the format (e.g. \"journal\").", suggestion: "Format words are already covered by the title and category; pair them with a topic or audience." });

  // Categories
  const suggestions = suggestCategories(facts);
  const known = m.categories.map((c) => ({ c, k: matchCategory(c) }));
  for (const { c, k } of known) {
    if (!k) notes.push({ field: "categories", severity: "medium", issue: `"${c}" is not a known Amazon Books category.`, suggestion: `Pick a real category, for example "${suggestions[0] ?? "the closest match in KDP's category picker"}".` });
    else if (!k.bookTypes.includes(facts.bookType)) notes.push({ field: "categories", severity: "medium", issue: `"${k.path}" is not a usual home for a ${facts.bookType.replace("-", " ")}.`, suggestion: `Readers browsing there expect something else; consider "${suggestions[0]}".` });
  }
  if (!m.categories.length) notes.push({ field: "categories", severity: "medium", issue: "No categories chosen.", suggestion: `Suggested: ${suggestions.slice(0, 3).map((s) => `"${s}"`).join(", ")}.` });
  return notes;
}
