import { FONT_METRICS } from "./fontMetricsData";
import { fontFile } from "./fonts";
import { wrapText } from "./textLayout";

/**
 * Text measurement from the bundled fonts' real advance widths, available
 * synchronously everywhere (node, browser, layout code). Renderers measure
 * with the font itself; layout code uses this to decide sizes and line
 * breaks before anything is drawn. Kerning is not included, so widths run a
 * touch wide, which errs toward wrapping early rather than overflowing.
 */

export interface FontMetrics {
  /** Cap height, thousandths of an em. */
  capHeight: number;
  /** Advance widths of METRIC_CHARS, thousandths of an em. */
  widths: number[];
}

/** Printable ASCII and Latin-1, plus the typographic punctuation titles use. */
export const METRIC_CHARS = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  ...Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)),
  "‘", "’", "“", "”", "–", "—", "…", "•", "€", "™",
].join("");

const INDEX = new Map([...METRIC_CHARS].map((ch, i) => [ch, i]));

/** Advance of a character missing from the table: the font's average lowercase letter. */
const fallback = new Map<string, number>();
function averageLower(file: string, m: FontMetrics): number {
  let v = fallback.get(file);
  if (v === undefined) {
    const lower = [..."abcdefghijklmnopqrstuvwxyz"].map((ch) => m.widths[INDEX.get(ch)!]);
    v = lower.reduce((a, b) => a + b, 0) / lower.length;
    fallback.set(file, v);
  }
  return v;
}

export function fontMetrics(family: string, bold: boolean): FontMetrics {
  return FONT_METRICS[fontFile(family, bold)] ?? FONT_METRICS[fontFile("Inter", bold)];
}

/** Width of `text` in points at `size`, with `letterSpacing` (em) added after every character as the renderers do. */
export function textWidth(text: string, family: string, bold: boolean, size: number, letterSpacing = 0): number {
  const file = fontFile(family, bold);
  const m = FONT_METRICS[file] ?? FONT_METRICS[fontFile("Inter", bold)];
  let units = 0;
  let count = 0;
  for (const ch of text) {
    const i = INDEX.get(ch);
    units += i === undefined ? averageLower(file, m) : m.widths[i];
    count++;
  }
  return (units / 1000) * size + count * letterSpacing * size;
}

/** Lines `text` wraps to in a box `width` wide, using the renderers' own wrapping rule. */
export function measureLines(text: string, family: string, bold: boolean, size: number, width: number, letterSpacing = 0): string[] {
  return wrapText(text, width, (s) => textWidth(s, family, bold, size, letterSpacing));
}

/** Cap height in points at `size`. */
export function capHeight(family: string, bold: boolean, size: number): number {
  return (fontMetrics(family, bold).capHeight / 1000) * size;
}
