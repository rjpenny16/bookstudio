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
