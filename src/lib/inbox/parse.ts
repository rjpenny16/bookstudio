import { MAX_PAGES, MIN_PAGES } from "@/lib/agent/blueprint";
import { TRIM_SIZES } from "@/lib/kdp/rules";

/**
 * Turns an idea typed on a phone ("large print sudoku for seniors, 120 pages")
 * into autopilot settings. Only what is said plainly is taken: a page count, a
 * trim size and "no art". Book type and the rest are inferred by autopilot from
 * the topic and audience, the same as the one-screen start.
 */
export interface ParsedIdea {
  topic: string;
  audience: string;
  pageTarget?: number;
  trimId?: string;
  /** False when the idea says "no art"; otherwise cover art runs when it is set up. */
  coverArt: boolean;
  /** Later lines of the message, passed to the brief as notes. */
  notes: string;
}

const PAGES = /\b(\d{2,3})\s*(?:-\s*)?(?:pages?|pp|pgs?)\b/i;
const TRIM = /\b(\d{1,2}(?:\.\d{1,2})?)\s*(?:"|in(?:ch(?:es)?)?)?\s*[x×]\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:"|in(?:ch(?:es)?)?)?(?=\W|$)/i;
const LETTER = /\b(?:letter|us letter)(?:[- ]size)?\b/i;
const NO_ART = /\b(?:no|without)\s+(?:ai\s+)?(?:cover\s+)?art\b/i;

const tidy = (s: string) =>
  s
    .replace(/\s*[,;]\s*(?=[,;]|$)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:.\-]+|[\s,;:.\-]+$/g, "");

export function parseIdea(text: string): ParsedIdea {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let idea = lines[0] ?? "";
  const notes = lines.slice(1).join("\n");

  let pageTarget: number | undefined;
  const pages = idea.match(PAGES);
  if (pages) {
    const n = Number(pages[1]);
    if (n >= MIN_PAGES && n <= MAX_PAGES) pageTarget = n;
    idea = idea.replace(pages[0], "");
  }

  let trimId: string | undefined;
  const trim = idea.match(TRIM);
  if (trim) {
    const id = `${Number(trim[1])}x${Number(trim[2])}`;
    if (TRIM_SIZES.some((t) => t.id === id)) trimId = id;
    idea = idea.replace(trim[0], "");
  } else if (LETTER.test(idea)) {
    trimId = "8.5x11";
    idea = idea.replace(LETTER, "");
  }

  const coverArt = !NO_ART.test(idea);
  idea = tidy(idea.replace(NO_ART, ""));

  // The last " for " splits the book from its reader: "sudoku for seniors", "gratitude journal for nurses".
  const at = idea.toLowerCase().lastIndexOf(" for ");
  const topic = at > 0 ? tidy(idea.slice(0, at)) : idea;
  const audience = at > 0 ? tidy(idea.slice(at + 5)) : "";
  return { topic, audience, pageTarget, trimId, coverArt, notes };
}

/** One line describing what will be built, for the queued reply. */
export function describeIdea(p: ParsedIdea): string {
  const bits = [p.audience ? `${p.topic} for ${p.audience}` : p.topic];
  if (p.pageTarget) bits.push(`${p.pageTarget} pages`);
  if (p.trimId) bits.push(TRIM_SIZES.find((t) => t.id === p.trimId)?.label ?? p.trimId);
  if (!p.coverArt) bits.push("no cover art");
  return bits.join(", ");
}
