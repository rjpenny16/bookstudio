import { luminance, parseHex } from "@/lib/util/color";

/**
 * Cover scoring on rendered pixels: how well each piece of text stands out
 * from what is actually behind it, how big the title is at search-thumbnail
 * size, how busy the background is, and how much of the cover the title
 * claims. Pure functions over ImageData-shaped rasters, so they run in node
 * tests as well as in the browser.
 */

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: ArrayLike<number>;
}

/** A box in raster pixels. */
export interface PxBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextSample {
  id: string;
  /** The title's hero words count double. */
  hero: boolean;
  color: string;
  box: PxBox;
  /** Large text (18 pt+, or 14 pt+ bold) needs 3:1; smaller text 4.5:1. */
  large: boolean;
}

export interface CoverScoreParts {
  contrast: number;
  heroSize: number;
  clutter: number;
  balance: number;
}

export interface CoverScore {
  /** 0-100. */
  score: number;
  parts: CoverScoreParts;
  /** Lowest per-text contrast (10th percentile of the pixels under it). */
  minContrast: number | null;
  textContrast: { elementId: string; ratio: number }[];
  /** Share of busy background pixels outside the text. */
  edgeDensity: number;
}

export const MAX_PARTS: CoverScoreParts = { contrast: 40, heroSize: 30, clutter: 15, balance: 15 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ramp = (v: number, zeroAt: number, fullAt: number) => clamp01((v - zeroAt) / (fullAt - zeroAt));

function clip(b: PxBox, r: Raster): PxBox {
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(r.width, Math.ceil(b.x + b.width));
  const y1 = Math.min(r.height, Math.ceil(b.y + b.height));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

const pixelLum = (d: ArrayLike<number>, i: number) => luminance([d[i], d[i + 1], d[i + 2]]);

/**
 * Contrast of `color` against the background inside `box`, taken at the 10th
 * percentile of pixels: a title that is fine over most of the art but lost
 * over one bright patch still scores low.
 */
export function textContrast(bg: Raster, box: PxBox, color: string): number {
  const rgb = parseHex(color);
  const b = clip(box, bg);
  if (!rgb || !b.width || !b.height) return 21;
  const lc = luminance(rgb);
  // About 2,500 samples whatever the box size.
  const step = Math.max(1, Math.floor(Math.sqrt((b.width * b.height) / 2500)));
  const ratios: number[] = [];
  for (let y = b.y; y < b.y + b.height; y += step) {
    for (let x = b.x; x < b.x + b.width; x += step) {
      const l = pixelLum(bg.data, (y * bg.width + x) * 4);
      const [hi, lo] = l > lc ? [l, lc] : [lc, l];
      ratios.push((hi + 0.05) / (lo + 0.05));
    }
  }
  ratios.sort((a, z) => a - z);
  return ratios[Math.floor(ratios.length * 0.1)];
}

/** Share of pixels outside `exclude` where luminance jumps sharply to a neighbour: how busy the background is. */
export function edgeDensity(r: Raster, exclude: PxBox[] = [], threshold = 0.1): number {
  const inside = (x: number, y: number) => exclude.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);
  let edges = 0;
  let n = 0;
  for (let y = 0; y < r.height - 1; y++) {
    for (let x = 0; x < r.width - 1; x++) {
      if (inside(x, y)) continue;
      const i = (y * r.width + x) * 4;
      const l = pixelLum(r.data, i);
      const dx = Math.abs(pixelLum(r.data, i + 4) - l);
      const dy = Math.abs(pixelLum(r.data, i + r.width * 4) - l);
      if (dx + dy > threshold) edges++;
      n++;
    }
  }
  return n ? edges / n : 0;
}

export interface ScoreInput {
  /** The front cover rendered without its text. */
  background: Raster;
  texts: TextSample[];
  /** Cap height of the hero words, in pixels, when the front is 160 px tall. */
  heroCapPx: number;
  /** Share of the front the hero words cover (0-1). */
  heroAreaShare: number;
  /** Edge density the genre wears comfortably (kids' and puzzle covers are busier by convention). */
  clutterOk?: number;
}

export function scoreCover(i: ScoreInput): CoverScore {
  const measured = i.texts.map((t) => ({ t, ratio: textContrast(i.background, t.box, t.color) }));
  // Below 1.5:1 nothing reads; 7:1 (9:1 for small text) reads at a glance, even printed on matte stock.
  const quality = measured.map(({ t, ratio }) => ({ w: t.hero ? 2 : 1, q: ramp(ratio, 1.5, t.large ? 7 : 9) }));
  const weight = quality.reduce((n, x) => n + x.w, 0);
  const avg = weight ? quality.reduce((n, x) => n + x.q * x.w, 0) / weight : 1;
  const worst = quality.length ? Math.min(...quality.map((x) => x.q)) : 1;
  const density = edgeDensity(i.background, i.texts.map((t) => t.box));
  const parts: CoverScoreParts = {
    contrast: MAX_PARTS.contrast * (0.5 * avg + 0.5 * worst),
    // Hero cap height in a 160 px search thumbnail: under 3 px is unreadable, 14 px jumps off the page.
    heroSize: MAX_PARTS.heroSize * ramp(i.heroCapPx, 3, 14),
    // Background busier than the genre wears starts to fight the title.
    clutter: MAX_PARTS.clutter * (1 - ramp(density, i.clutterOk ?? 0.06, (i.clutterOk ?? 0.06) + 0.15)),
    // The hero should claim a real share of the front, but not so much it crowds everything else.
    balance: MAX_PARTS.balance * Math.min(ramp(i.heroAreaShare, 0.03, 0.1), 1 - ramp(i.heroAreaShare, 0.4, 0.6)),
  };
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    score: round(parts.contrast + parts.heroSize + parts.clutter + parts.balance),
    parts: { contrast: round(parts.contrast), heroSize: round(parts.heroSize), clutter: round(parts.clutter), balance: round(parts.balance) },
    minContrast: measured.length ? round(Math.min(...measured.map((m) => m.ratio))) : null,
    textContrast: measured.map(({ t, ratio }) => ({ elementId: t.id, ratio: round(ratio) })),
    edgeDensity: Math.round(density * 1000) / 1000,
  };
}

/** A short fingerprint of a cover's content, so a stored analysis is only trusted while the cover is unchanged. */
export function coverKey(cover: { background: string; elements: unknown[] }): string {
  const s = JSON.stringify([cover.background, cover.elements], (k, v) => (k === "provenance" ? undefined : typeof v === "number" ? Math.round(v * 10) / 10 : v));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
