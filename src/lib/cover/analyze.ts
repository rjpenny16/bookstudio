"use client";

import type { CoverGeometry } from "@/lib/kdp/geometry";
import { THUMBNAIL_PX } from "@/lib/quality/design";
import { coverKey, scoreCover, type PxBox, type TextSample } from "@/lib/quality/coverScore";
import { ensureFonts, loadImages, rasterize, type ImageCache } from "@/lib/render/canvas";
import { capHeight } from "@/lib/render/metrics";
import { elementBounds } from "@/lib/schema/elements";
import type { Asset, Cover, CoverAnalysis, Element, TextElement } from "@/lib/schema/project";

/**
 * Render the front cover and score it on its pixels (see quality/coverScore):
 * every text against what is drawn behind it, art included, the hero title
 * at search-thumbnail size, and how busy the background is.
 */

const ANALYSIS_PX = 600;

/** Front text worth judging; puzzle motifs are decoration, not copy. */
export const isJudgedText = (e: Element): e is TextElement => e.type === "text" && !!e.text.trim() && !e.name?.startsWith("Motif");

export async function analyzeCover(cover: Pick<Cover, "background" | "elements">, cg: CoverGeometry, assets: Asset[], opts: { clutterOk?: number; cache?: ImageCache } = {}): Promise<CoverAnalysis> {
  await ensureFonts();
  const images = await loadImages(assets, opts.cache);
  const f = cg.front;
  const scale = ANALYSIS_PX / f.height;
  const bg = rasterize({ widthPt: f.width, heightPt: f.height, scale, background: cover.background, elements: cover.elements.filter((e) => e.type !== "text"), images, originX: -f.x, originY: -f.y });
  const background = bg.getContext("2d")!.getImageData(0, 0, bg.width, bg.height);
  const toPx = (b: { x: number; y: number; width: number; height: number }): PxBox => ({ x: (b.x - f.x) * scale, y: (b.y - f.y) * scale, width: b.width * scale, height: b.height * scale });
  const front = cover.elements.filter(isJudgedText).filter((e) => {
    const b = elementBounds(e);
    return b.x + b.width / 2 >= f.x && b.x + b.width / 2 <= f.x + f.width;
  });
  const hero = front.find((e) => e.name === "Title") ?? [...front].sort((a, b) => b.fontSize - a.fontSize)[0];
  const texts: TextSample[] = front.map((e) => ({ id: e.id, hero: e === hero, color: e.color, box: toPx(elementBounds(e)), large: e.fontSize >= 18 || (e.bold && e.fontSize >= 14) }));
  const heroBox = hero ? elementBounds(hero) : null;
  const r = scoreCover({
    background,
    texts,
    heroCapPx: hero ? (capHeight(hero.fontFamily, hero.bold, hero.fontSize) * THUMBNAIL_PX) / f.height : 0,
    heroAreaShare: heroBox ? (heroBox.width * heroBox.height) / (f.width * f.height) : 0,
    clutterOk: opts.clutterOk,
  });
  return { at: new Date().toISOString(), key: coverKey(cover), score: r.score, parts: r.parts, minContrast: r.minContrast, edgeDensity: r.edgeDensity, textContrast: r.textContrast };
}
