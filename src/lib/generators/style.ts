import type { GenreId } from "@/lib/cover/genres";
import type { Project } from "@/lib/schema/project";

/**
 * How the interior looks: the faces for headings, body text and labels, the
 * type sizes, and the ornament on dividers and the title page. A style is
 * picked from the book's genre (so the inside matches the cover) and whether
 * it is large print (so everything a reader reads is 14 pt or more).
 */

export type OrnamentKind = "rule" | "grid" | "stars" | "sprig" | "flourish" | "diamond" | "bars" | "double-rule";

export interface InteriorStyle {
  genre: GenreId | null;
  largePrint: boolean;
  /** Page titles, divider titles and the title page. */
  heading: { family: string; bold: boolean };
  /** Prompts, paragraphs and affirmations. */
  body: string;
  /** Puzzle numbers, word lists, field labels and page numbers. */
  label: string;
  ornament: OrnamentKind;
  sizes: {
    /** Title of the book on the title page (upper bound; fitted to the width). */
    title: number;
    /** Divider titles (upper bound; fitted to the width). */
    divider: number;
    /** Page headings ("Contents", "Today I Am Grateful", a word-search theme). */
    pageTitle: number;
    /** Puzzle numbers and section labels on a page. */
    label: number;
    /** Prompts and paragraphs. */
    body: number;
    /** Smallest text a reader reads: word lists, hints, field labels. */
    small: number;
    /** Labels inside answer keys (reference material, so it may be smaller). */
    key: number;
    pageNumber: number;
  };
}

/** What the style is stored as on a project; the rest is derived. */
export interface InteriorStyleSpec {
  genre: GenreId | null;
  largePrint: boolean;
}

interface Faces {
  heading: { family: string; bold: boolean };
  body: string;
  label: string;
  ornament: OrnamentKind;
}

/** Interior faces per genre: the cover's display family for headings where it reads well at heading size, a book face for text. */
const FACES: Record<GenreId, Faces> = {
  puzzle: { heading: { family: "Oswald", bold: true }, body: "Inter", label: "Inter", ornament: "grid" },
  "large-print": { heading: { family: "Montserrat", bold: true }, body: "Inter", label: "Inter", ornament: "grid" },
  kids: { heading: { family: "Fredoka", bold: true }, body: "Fredoka", label: "Fredoka", ornament: "stars" },
  wellness: { heading: { family: "DM Serif Display", bold: false }, body: "Lora", label: "Raleway", ornament: "sprig" },
  faith: { heading: { family: "Playfair Display", bold: true }, body: "Lora", label: "Raleway", ornament: "flourish" },
  journal: { heading: { family: "DM Serif Display", bold: false }, body: "Lora", label: "Raleway", ornament: "diamond" },
  planner: { heading: { family: "Montserrat", bold: true }, body: "Inter", label: "Inter", ornament: "bars" },
  "log-book": { heading: { family: "Roboto Slab", bold: true }, body: "Inter", label: "Inter", ornament: "double-rule" },
};

/** The look books had before styles: Lora headings, Inter labels, a plain rule. */
const CLASSIC: Faces = { heading: { family: "Lora", bold: true }, body: "Lora", label: "Inter", ornament: "rule" };

const REGULAR_SIZES: InteriorStyle["sizes"] = { title: 30, divider: 32, pageTitle: 18, label: 12, body: 12, small: 10, key: 9, pageNumber: 9 };
/** Large print: nothing a reader reads below 14 pt. */
const LARGE_SIZES: InteriorStyle["sizes"] = { title: 36, divider: 40, pageTitle: 24, label: 18, body: 16, small: 14, key: 12, pageNumber: 12 };
/** Kids read bigger type too, but the pages hold more pictures than words. */
const KIDS_SIZES: InteriorStyle["sizes"] = { title: 34, divider: 38, pageTitle: 22, label: 16, body: 14, small: 13, key: 10, pageNumber: 11 };

export const LARGE_PRINT_MIN_PT = 14;

export function interiorStyle(spec: Partial<InteriorStyleSpec> = {}): InteriorStyle {
  const genre = spec.genre ?? null;
  const largePrint = spec.largePrint ?? genre === "large-print";
  const faces = genre ? FACES[genre] : CLASSIC;
  const sizes = largePrint ? LARGE_SIZES : genre === "kids" ? KIDS_SIZES : REGULAR_SIZES;
  return { genre, largePrint, ...faces, sizes: { ...sizes } };
}

export const CLASSIC_STYLE = interiorStyle();

/** A project's interior style. Books made before styles keep the classic look, so regenerated sections match the rest. */
export function styleOf(project: Pick<Project, "interior">): InteriorStyle {
  return project.interior.style ? interiorStyle(project.interior.style) : CLASSIC_STYLE;
}

/* ------------------------------- ornaments -------------------------------- */

/** An ornament drawn in a `w` x `h` box (SVG path data in that space), filled or stroked. */
export interface Ornament {
  w: number;
  h: number;
  d: string;
  fill: boolean;
  strokeWidth: number;
}

const r = (n: number) => Math.round(n * 100) / 100;

function star(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.45;
  const pts = Array.from({ length: 10 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rad = k % 2 ? inner : outer;
    return `${r(cx + rad * Math.cos(a))} ${r(cy + rad * Math.sin(a))}`;
  });
  return `M ${pts.join(" L ")} Z`;
}

/** A pointed leaf from (x, y) along angle `a` (radians), `len` long. */
function leaf(x: number, y: number, a: number, len: number): string {
  const ex = x + len * Math.cos(a);
  const ey = y + len * Math.sin(a);
  const nx = -Math.sin(a) * len * 0.32;
  const ny = Math.cos(a) * len * 0.32;
  const mx = (x + ex) / 2;
  const my = (y + ey) / 2;
  return `M ${r(x)} ${r(y)} Q ${r(mx + nx)} ${r(my + ny)} ${r(ex)} ${r(ey)} Q ${r(mx - nx)} ${r(my - ny)} ${r(x)} ${r(y)} Z`;
}

function diamond(cx: number, cy: number, s: number): string {
  return `M ${r(cx)} ${r(cy - s)} L ${r(cx + s)} ${r(cy)} L ${r(cx)} ${r(cy + s)} L ${r(cx - s)} ${r(cy)} Z`;
}

/** The ornament for a style, about 120 x 24 units; scale it to taste. */
export function ornament(kind: OrnamentKind): Ornament[] {
  switch (kind) {
    case "grid": {
      // A corner of a puzzle grid: 3 x 3 cells, two of them shaded.
      const s = 8;
      const x0 = 60 - 1.5 * s;
      const cells = [0, 4, 8].map((k) => `M ${x0 + (k % 3) * s} ${(Math.floor(k / 3)) * s} h ${s} v ${s} h ${-s} Z`).join(" ");
      const lines = [0, 1, 2, 3].map((k) => `M ${x0 + k * s} 0 V ${3 * s} M ${x0} ${k * s} H ${x0 + 3 * s}`).join(" ");
      return [
        { w: 120, h: 24, d: cells, fill: true, strokeWidth: 0 },
        { w: 120, h: 24, d: `${lines} M 8 12 H ${x0 - 8} M ${x0 + 3 * s + 8} 12 H 112`, fill: false, strokeWidth: 1.2 },
      ];
    }
    case "stars":
      return [{ w: 120, h: 24, d: [star(36, 13, 7), star(60, 12, 11), star(84, 13, 7)].join(" "), fill: true, strokeWidth: 0 }];
    case "sprig": {
      const leaves = [-1, 1].flatMap((side) => [0, 1, 2].map((k) => leaf(60 + side * (10 + k * 14), 12, side > 0 ? -0.5 : Math.PI + 0.5, 11 - k * 2)));
      const leaves2 = [-1, 1].flatMap((side) => [0, 1, 2].map((k) => leaf(60 + side * (10 + k * 14), 12, side > 0 ? 0.5 : Math.PI - 0.5, 11 - k * 2)));
      return [
        { w: 120, h: 24, d: [...leaves, ...leaves2, `M ${r(57)} 12 a 3 3 0 1 0 6 0 a 3 3 0 1 0 -6 0 Z`].join(" "), fill: true, strokeWidth: 0 },
        { w: 120, h: 24, d: "M 18 12 H 102", fill: false, strokeWidth: 0.8 },
      ];
    }
    case "flourish":
      return [
        { w: 120, h: 24, d: "M 8 12 C 24 2, 38 22, 52 12 M 112 12 C 96 2, 82 22, 68 12", fill: false, strokeWidth: 1.1 },
        { w: 120, h: 24, d: diamond(60, 12, 5), fill: true, strokeWidth: 0 },
      ];
    case "diamond":
      return [
        { w: 120, h: 24, d: "M 10 12 H 50 M 70 12 H 110", fill: false, strokeWidth: 0.9 },
        { w: 120, h: 24, d: `${diamond(60, 12, 4.5)} ${diamond(48, 12, 2)} ${diamond(72, 12, 2)}`, fill: true, strokeWidth: 0 },
      ];
    case "bars":
      return [{ w: 120, h: 24, d: "M 30 6 h 60 v 3 h -60 Z M 40 11 h 40 v 3 h -40 Z M 50 16 h 20 v 3 h -20 Z", fill: true, strokeWidth: 0 }];
    case "double-rule":
      return [{ w: 120, h: 24, d: "M 6 9 H 114 M 6 15 H 114", fill: false, strokeWidth: 1 }];
    default:
      return [{ w: 120, h: 24, d: "M 30 12 H 90", fill: false, strokeWidth: 1.2 }];
  }
}
