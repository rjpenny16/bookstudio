import { LISTING, PROHIBITED_LISTING_TERMS } from "@/lib/kdp/rules";
import type { BookType, ListingMetadata } from "@/lib/schema/project";

export interface ListingValidation {
  errors: string[];
  warnings: string[];
  /** Keyword problems that `cleanKeywords` can fix automatically. */
  cleanable: boolean;
}

export function findProhibited(s: string): string[] {
  const lower = s.toLowerCase();
  return PROHIBITED_LISTING_TERMS.filter((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(lower);
  });
}

export function validateListing(m: ListingMetadata, bookType?: BookType): ListingValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let cleanable = false;
  if (!m.title.trim()) errors.push("Title is required.");
  if (!m.author.trim()) errors.push("Author / pen name is required.");
  const ts = m.title.length + (m.subtitle ? m.subtitle.length : 0);
  if (ts > LISTING.maxTitleSubtitleChars) errors.push(`Title + subtitle is ${ts} characters (max ${LISTING.maxTitleSubtitleChars}).`);
  const titleBad = findProhibited(`${m.title} ${m.subtitle}`);
  if (titleBad.length) errors.push(`Title/subtitle contains disallowed terms: ${titleBad.join(", ")}.`);
  if (!m.description.trim()) errors.push("Description is required.");
  if (m.description.length > LISTING.maxDescriptionChars) errors.push(`Description is ${m.description.length} characters (max ${LISTING.maxDescriptionChars}).`);
  else if (m.description.trim() && m.description.length < 150) warnings.push("Description is short; 150+ characters help conversion.");
  const kws = m.keywords.filter((k) => k.trim());
  if (kws.length > LISTING.maxKeywords) {
    errors.push(`${kws.length} keywords; KDP allows ${LISTING.maxKeywords}.`);
    cleanable = true;
  }
  if (kws.length === 0) warnings.push("No keywords yet; KDP gives you 7 keyword slots.");
  else if (kws.length < LISTING.maxKeywords) warnings.push(`Only ${kws.length} of ${LISTING.maxKeywords} keyword slots used.`);
  for (const k of kws) {
    if (k.length > LISTING.maxKeywordChars) {
      errors.push(`Keyword "${k.slice(0, 30)}…" is longer than ${LISTING.maxKeywordChars} characters.`);
      cleanable = true;
    }
    const bad = findProhibited(k);
    if (bad.length) {
      errors.push(`Keyword "${k}" contains disallowed terms: ${bad.join(", ")}.`);
      cleanable = true;
    }
  }
  const titleWords = new Set(m.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const repeated = kws.filter((k) => k.toLowerCase().split(/\W+/).every((w) => !w || titleWords.has(w)));
  if (repeated.length) warnings.push(`Keywords that only repeat title words waste a slot: ${repeated.join(", ")}.`);
  if (m.categories.length > LISTING.maxCategories) errors.push(`KDP allows up to ${LISTING.maxCategories} categories.`);
  if (m.categories.length === 0) warnings.push("Pick up to 3 categories when you publish.");
  if (bookType && (bookType === "puzzle" || bookType === "coloring") && m.isbn.kind === "none") warnings.push("Puzzle and coloring books are not low-content; KDP will ask for an ISBN (free KDP ISBN is fine).");
  return { errors, warnings, cleanable };
}

export function cleanKeywords(keywords: string[]): string[] {
  const out: string[] = [];
  for (const raw of keywords) {
    let k = raw.trim().replace(/\s+/g, " ");
    for (const term of findProhibited(k)) k = k.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&"), "ig"), " ").replace(/\s+/g, " ").trim();
    if (k.length > LISTING.maxKeywordChars) k = k.slice(0, LISTING.maxKeywordChars).replace(/\s+\S*$/, "");
    if (k && !out.some((o) => o.toLowerCase() === k.toLowerCase())) out.push(k);
  }
  return out.slice(0, LISTING.maxKeywords);
}
