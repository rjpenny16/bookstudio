import { contrastRatio, legibleOn, mixHex, TEXT_CONTRAST } from "@/lib/util/color";
import type { Palette } from "./templates";

/**
 * A cover palette taken from the artwork itself, so title plates and the back
 * cover pick up the art's colors instead of a stock palette that may clash.
 * k-means over a small sample of pixels: the biggest cluster becomes the
 * background, the most vivid distinct one the accent, and the text color is
 * whichever of near-black and white reads best on the background.
 */

export const ART_PALETTE_ID = "art";

type Rgb = [number, number, number];

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

function saturation([r, g, b]: Rgb): number {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Clusters of an RGBA image, largest first: each cluster's mean color and its share of the pixels. */
export function colorClusters(rgba: ArrayLike<number>, k = 5, iterations = 10): { color: Rgb; share: number }[] {
  const px: Rgb[] = [];
  const step = Math.max(1, Math.floor(rgba.length / 4 / 4000)) * 4;
  for (let i = 0; i + 3 < rgba.length; i += step) if (rgba[i + 3] > 0) px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  if (!px.length) return [];
  // Deterministic start: centers spread evenly through the pixels sorted by brightness.
  const sorted = [...px].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centers: Rgb[] = Array.from({ length: Math.min(k, px.length) }, (_, j) => [...sorted[Math.floor(((j + 0.5) * sorted.length) / k)]] as Rgb);
  let counts: number[] = [];
  for (let it = 0; it < iterations; it++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of px) {
      let best = 0;
      for (let j = 1; j < centers.length; j++) if (dist2(p, centers[j]) < dist2(p, centers[best])) best = j;
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      counts[best]++;
    }
    centers = centers.map((c, j) => (counts[j] ? [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]] : c));
  }
  return centers.map((color, j) => ({ color, share: counts[j] / px.length })).filter((c) => c.share > 0).sort((a, b) => b.share - a.share);
}

export function paletteFromPixels(rgba: ArrayLike<number>): Palette | null {
  const clusters = colorClusters(rgba);
  if (!clusters.length) return null;
  const bgRgb = clusters[0].color;
  const bg = hex(bgRgb);
  const fg = legibleOn(bg, contrastRatio("#111111", bg)! >= contrastRatio("#ffffff", bg)! ? "#111111" : "#ffffff", ["#111111", "#ffffff"], TEXT_CONTRAST);
  // The accent: vivid, clearly different from the background, and not a speck.
  const accentCluster = clusters
    .slice(1)
    .filter((c) => c.share >= 0.03 && Math.sqrt(dist2(c.color, bgRgb)) > 60)
    .sort((a, b) => saturation(b.color) * Math.sqrt(b.share) - saturation(a.color) * Math.sqrt(a.share))[0];
  const accent = accentCluster ? hex(accentCluster.color) : mixHex(fg, bg, 0.5);
  return { id: ART_PALETTE_ID, name: "From the art", bg, fg, accent, muted: mixHex(fg, bg, 0.3) };
}
