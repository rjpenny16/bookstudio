import type { Box } from "@/lib/kdp/geometry";
import { text } from "@/lib/schema/elements";
import type { TextElement } from "@/lib/schema/project";
import type { TypeSystem } from "./genres";
import { balancedWidth, estLines, fitFontSize, titleBlock } from "./layout";

/**
 * Title lockups. Bestselling covers rarely set the title as one block: the
 * word a shopper searched for ("SUDOKU", "Gratitude") is set huge, and the
 * words around it are set small, a qualifier above ("LARGE PRINT") and the
 * format and audience below ("Puzzles for Seniors"). This splits a title
 * that way and lays the parts out at tied sizes, so the hero reads at
 * thumbnail size and the rest still reads in order as the full title.
 */

export interface TitleParts {
  kicker?: string;
  hero: string;
  support?: string;
}

/** Leading words that qualify the title rather than name it. */
const QUALIFIER = /^(?:(?:easy|medium) to (?:hard|expert|difficult|challenging)|(?:extra[- ])?large[- ]print|jumbo|giant|big|easy|medium|hard|the|my|our|a|an|daily|weekly|monthly|yearly|undated|dated|simple|simply|mini|deluxe|ultimate|complete|official|5[- ]minute|one[- ]line|\d[\d,]*\+?)\s+/i;

/** Trailing format words, longest first. */
const FORMAT = ["activity book", "coloring book", "colouring book", "puzzle book", "puzzles book", "log book", "logbook", "workbook", "notebook", "journal", "planner", "puzzles", "puzzle", "book", "organizer", "tracker", "diary", "games"];

const PREPOSITION = /\s+(for|with|to help|about|from)\s+/i;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Split a title into kicker, hero and support. `hero` (from the brief: the
 * words shoppers search for) is used when it is a whole-word run inside the
 * title; otherwise the split comes from the title's own shape.
 */
export function splitTitle(title: string, hero?: string): TitleParts {
  const whole = title.trim().replace(/\s+/g, " ");
  if (!whole) return { hero: whole };
  const hinted = hero?.trim() ? splitAround(whole, hero.trim()) : null;
  if (hinted) return hinted;
  let main = whole;
  let after = "";
  let tail = "";
  const colon = main.indexOf(":");
  if (colon > 0) {
    after = main.slice(colon + 1).trim();
    main = main.slice(0, colon).trim();
  }
  const prep = main.match(PREPOSITION);
  if (prep && prep.index! > 0) {
    tail = main.slice(prep.index! + 1);
    main = main.slice(0, prep.index!);
  }
  let kicker = "";
  for (let m = main.match(QUALIFIER); m && m[0].length < main.length; m = main.match(QUALIFIER)) {
    kicker = `${kicker} ${m[0].trim()}`.trim();
    main = main.slice(m[0].length);
  }
  let format = "";
  const lower = main.toLowerCase();
  // "Mazes and Word Puzzles" names two things; splitting off "Puzzles" would leave half of one.
  const f = /\s(and|&)\s/i.test(main) ? undefined : FORMAT.find((w) => lower.endsWith(` ${w}`) && !FORMAT.includes(lower.slice(0, -w.length - 1)));
  if (f) {
    format = main.slice(main.length - f.length);
    main = main.slice(0, main.length - f.length - 1);
  }
  const lead = [format, tail].filter(Boolean).join(" ").trim();
  const support = after ? (lead ? `${lead}: ${after}` : after) : lead;
  const parts: TitleParts = { hero: main.trim(), ...(kicker ? { kicker } : {}), ...(support ? { support } : {}) };
  // Never lose or reorder a word: the parts must still read as the listing title.
  const rejoined = norm([parts.kicker, parts.hero, parts.support].filter(Boolean).join(" "));
  if (!parts.hero || parts.hero.replace(/[^\p{L}\p{N}]/gu, "").length < 3 || rejoined !== norm(whole)) return { hero: whole };
  return parts;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The title split around `hero`, when it is a whole-word run within the title and the words before it are few enough to be a kicker. */
function splitAround(whole: string, hero: string): TitleParts | null {
  const m = new RegExp(`(^|[\\s:])(${escapeRe(hero.replace(/\s+/g, " "))})(?=$|[\\s:,!?.])`, "i").exec(whole);
  if (!m) return null;
  const start = m.index + m[1].length;
  const kicker = whole.slice(0, start).replace(/[\s:]+$/, "").trim();
  const support = whole.slice(start + m[2].length).replace(/^[\s:,]+/, "").trim();
  if (kicker.split(/\s+/).length > 4 || m[2].replace(/[^\p{L}\p{N}]/gu, "").length < 3) return null;
  return { hero: m[2], ...(kicker ? { kicker } : {}), ...(support ? { support } : {}) };
}

export interface LockupOptions {
  /** Width and top of the lockup; height is what it needs. */
  box: Box;
  /** The template's own title face, used when the book has no genre type system. */
  family: string;
  bold?: boolean;
  /** Largest hero size, pt. */
  max: number;
  /** Total height the lockup may take. */
  maxH?: number;
  color: string;
  supportColor?: string;
  kickerColor?: string;
  align?: "left" | "center";
  maxLines?: number;
  /** Capitals, for templates whose own look is set in them (a genre type system decides instead when there is one). */
  upper?: boolean;
  supportFamily?: string;
}

export interface Lockup {
  elements: TextElement[];
  /** The hero element ("Title"), largest text on the front. */
  hero: TextElement;
  height: number;
  /** Top of the lockup; setting it moves every part. */
  y: number;
  /** Rotation applied to every part. */
  rotation: number;
}

const LH = 1.13;

/** Lay out a book's title as kicker, hero and support at tied sizes. */
export function lockup(input: { title: string; titleHero?: string; type?: TypeSystem }, o: LockupOptions): Lockup {
  const t = input.type;
  const parts = splitTitle(input.title, input.titleHero);
  // A genre's type system decides the case; without one the template's own look does.
  const heroUpper = t ? t.heroUpper : (o.upper ?? false);
  const supportUpper = t ? t.supportUpper : (o.upper ?? false);
  const heroFamily = t?.hero ?? o.family;
  const heroBold = t ? t.heroBold : (o.bold ?? true);
  const supportFamily = t?.support ?? o.supportFamily ?? o.family;
  const supportBold = t ? t.supportBold : (o.bold ?? true);
  const kickerFamily = t?.kicker ?? supportFamily;
  const align = o.align ?? "center";
  const heroText = heroUpper ? parts.hero.toUpperCase() : parts.hero;
  const supportText = parts.support ? (supportUpper ? parts.support.toUpperCase() : parts.support) : "";
  const kickerText = parts.kicker?.toUpperCase() ?? "";
  const heroWords = parts.hero.split(/\s+/).length;
  const maxLines = o.maxLines ?? (heroWords <= 2 ? 2 : 3);
  const box = o.box;

  const build = (max: number) => {
    const hero = titleBlock(heroText, heroFamily, box, 0, max, o.color, align, maxLines, { bold: heroBold });
    const h = hero.fontSize;
    const els: TextElement[] = [];
    let y = 0;
    if (kickerText) {
      const size = Math.max(9, Math.min(26, h * 0.3));
      const ls = 0.16;
      const fit = fitFontSize(kickerText, kickerFamily, box.width, 1, size, 8, { bold: true, letterSpacing: ls });
      const kh = fit * LH;
      els.push(place(text({ x: box.x, y, width: box.width, height: kh, text: kickerText, fontFamily: kickerFamily, bold: true, fontSize: fit, color: o.kickerColor ?? o.supportColor ?? o.color, align, lineHeight: 1, letterSpacing: ls, name: "Title kicker" }), box, align, { bold: true, letterSpacing: ls }));
      y += kh + h * 0.12;
    }
    hero.y = y;
    els.push(hero);
    y += hero.height;
    if (supportText) {
      const ls = supportUpper ? 0.08 : 0;
      const target = Math.max(11, Math.min(44, h * (supportUpper ? 0.34 : 0.42)));
      const size = fitFontSize(supportText, supportFamily, box.width, 2, target, 8, { bold: supportBold, letterSpacing: ls });
      const lines = estLines(supportText, supportFamily, box.width, size, { bold: supportBold, letterSpacing: ls });
      y += h * 0.1;
      const sh = lines * size * LH * 1.1;
      els.push(place(text({ x: box.x, y, width: box.width, height: sh, text: supportText, fontFamily: supportFamily, bold: supportBold, fontSize: size, color: o.supportColor ?? o.color, align, lineHeight: 1.1, ...(ls ? { letterSpacing: ls } : {}), name: "Title support" }), box, align, { bold: supportBold, letterSpacing: ls }));
      y += sh;
    }
    return { els, hero, height: y };
  };

  let max = o.max;
  let out = build(max);
  while (o.maxH !== undefined && out.height > o.maxH && max > 12) out = build((max -= 1));
  const { els, hero } = out;
  for (const e of els) e.y += box.y;
  let top = box.y;
  let rotation = 0;
  return {
    elements: els,
    hero,
    height: out.height,
    get y() {
      return top;
    },
    set y(v: number) {
      for (const e of els) e.y += v - top;
      top = v;
    },
    get rotation() {
      return rotation;
    },
    set rotation(deg: number) {
      rotation = deg;
      for (const e of els) e.rotation = deg;
    },
  };
}

/** Narrow a text box to its balanced width, keeping its alignment within `box`. */
function place(el: TextElement, box: Box, align: "left" | "center", o: { bold: boolean; letterSpacing: number }): TextElement {
  const w = balancedWidth(el.text, el.fontFamily, el.fontSize, box.width, o);
  return { ...el, width: w, x: align === "center" ? box.x + (box.width - w) / 2 : box.x };
}
