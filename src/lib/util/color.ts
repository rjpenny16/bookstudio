function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colors (1-21), or null if either isn't a hex color. */
export function contrastRatio(a: string, b: string): number | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  const [hi, lo] = [luminance(ra), luminance(rb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for large text (18 pt+, or 14 pt+ bold). */
export const LARGE_TEXT_CONTRAST = 3;
/** WCAG AA for body-size text. */
export const TEXT_CONTRAST = 4.5;

/**
 * The first of `preferred`, then `candidates`, that reads well on `backdrop`, so
 * a palette keeps its look where it can. Falls back to near-black or white.
 */
export function legibleOn(backdrop: string, preferred: string, candidates: string[], min = LARGE_TEXT_CONTRAST): string {
  const ok = [preferred, ...candidates].find((c) => (contrastRatio(c, backdrop) ?? 21) >= min);
  if (ok) return ok;
  return (contrastRatio("#111111", backdrop) ?? 0) >= (contrastRatio("#ffffff", backdrop) ?? 0) ? "#111111" : "#ffffff";
}

/** Blend two hex colors: `t` = 0 gives `a`, 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return a;
  return `#${ra.map((c, i) => Math.round(c + (rb[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Like legibleOn, but the color must read on every one of `backdrops` (e.g. a see-through plate over varying art). */
export function legibleOnAll(backdrops: string[], preferred: string, candidates: string[], min = LARGE_TEXT_CONTRAST): string {
  const worst = (c: string) => Math.min(...backdrops.map((b) => contrastRatio(c, b) ?? 21));
  const ok = [preferred, ...candidates].find((c) => worst(c) >= min);
  if (ok) return ok;
  return worst("#111111") >= worst("#ffffff") ? "#111111" : "#ffffff";
}

/**
 * Tone of a region of an image from its RGBA pixels: the average color and
 * how much luminance varies (0 = flat, ~0.5 = black-and-white noise).
 */
export function regionTone(rgba: ArrayLike<number>): { mean: string; spread: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  const lums: number[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    lums.push(luminance([rgba[i], rgba[i + 1], rgba[i + 2]]));
  }
  const n = Math.max(1, lums.length);
  const avg = lums.reduce((s, l) => s + l, 0) / n;
  const spread = Math.sqrt(lums.reduce((s, l) => s + (l - avg) ** 2, 0) / n);
  const hex = [r, g, b].map((c) => Math.round(c / n).toString(16).padStart(2, "0")).join("");
  return { mean: `#${hex}`, spread };
}

/** Share of pixels (0-1) on which `color` falls below `min` contrast: how much of the title would get lost in the art. */
export function lowContrastShare(rgba: ArrayLike<number>, color: string, min = LARGE_TEXT_CONTRAST): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;
  const lc = luminance(rgb);
  let low = 0;
  let n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const l = luminance([rgba[i], rgba[i + 1], rgba[i + 2]]);
    const [hi, lo] = l > lc ? [l, lc] : [lc, l];
    if ((hi + 0.05) / (lo + 0.05) < min) low++;
    n++;
  }
  return n ? low / n : 0;
}

/** Rotate a hex color's hue by `deg` degrees, keeping saturation and lightness. */
export function shiftHue(hex: string, deg: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return hex;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
