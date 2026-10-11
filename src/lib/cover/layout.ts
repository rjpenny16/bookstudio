import type { Box, CoverGeometry } from "@/lib/kdp/geometry";
import { image, rect, text } from "@/lib/schema/elements";
import type { Element, TextElement } from "@/lib/schema/project";
import type { CoverInput } from "./templates";

/**
 * Text fitting and the back cover and spine shared by every cover design:
 * the built-in templates, the template library and saved templates.
 */

/** Average advance per character as a fraction of the font size: [lowercase, capitals and digits, space], measured from the bundled bold cuts. */
const CHAR_FACTOR: Record<string, [number, number, number]> = {
  Inter: [0.55, 0.69, 0.24],
  Montserrat: [0.59, 0.73, 0.28],
  Oswald: [0.45, 0.53, 0.26],
  Anton: [0.45, 0.47, 0.24],
  Merriweather: [0.6, 0.72, 0.28],
  Lora: [0.53, 0.68, 0.26],
  "Playfair Display": [0.52, 0.68, 0.23],
  Pacifico: [0.45, 0.8, 0.27],
  Caveat: [0.42, 0.5, 0.25],
  "Roboto Mono": [0.6, 0.6, 0.6],
};

/** A little slack so estimates err toward wrapping early rather than overflowing. */
const SAFETY = 1.04;

function wordWidth(w: string, f: [number, number, number], size: number): number {
  let em = 0;
  for (const ch of w) em += /[A-Z0-9]/.test(ch) ? f[1] : f[0];
  return em * size * SAFETY;
}

/** Lines `s` wraps to at `size` in `width`, or Infinity when a single word is too wide. */
function wrapCount(s: string, family: string, width: number, size: number): number {
  const f = CHAR_FACTOR[family] ?? CHAR_FACTOR.Inter;
  const space = f[2] * size;
  let lines = 1;
  let cur = 0;
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const len = wordWidth(w, f, size);
    if (len > width) return Infinity;
    const next = cur === 0 ? len : cur + space + len;
    if (next > width && cur > 0) {
      lines++;
      cur = len;
    } else cur = next;
  }
  return lines;
}

/** Largest font size (<= max) at which `s` fits within `maxLines` lines of `width`. */
export function fitFontSize(s: string, family: string, width: number, maxLines: number, max: number, min = 10): number {
  for (let size = max; size > min; size -= 1) if (wrapCount(s, family, width, size) <= maxLines) return size;
  return min;
}

export function estLines(s: string, family: string, width: number, size: number): number {
  const n = wrapCount(s, family, width, size);
  // A word wider than the box still renders (on its own line); count words as a floor.
  return Number.isFinite(n) ? n : Math.max(1, s.split(/\s+/).filter(Boolean).length);
}

export function titleBlock(s: string, family: string, box: Box, y: number, max: number, color: string, align: "left" | "center" = "center", maxLines = 3): TextElement {
  const size = fitFontSize(s, family, box.width, maxLines, max);
  const lines = estLines(s, family, box.width, size);
  return text({ x: box.x, y, width: box.width, height: lines * size * 1.13 * 1.05, text: s, fontFamily: family, bold: true, fontSize: size, color, align, lineHeight: 1.05, name: "Title" });
}

/** Title that fits `maxH`: shrink from `max` until it does. */
export function fitTitle(s: string, family: string, box: Box, max: number, maxH: number, color: string, align: "left" | "center" = "center", maxLines = 3): TextElement {
  let size = max;
  let t = titleBlock(s, family, box, box.y, size, color, align, maxLines);
  while (t.height > maxH && size > 16) t = titleBlock(s, family, box, box.y, (size -= 3), color, align, maxLines);
  return t;
}

export function backCover(cg: CoverGeometry, input: CoverInput, color: string, family = "Lora"): Element[] {
  const b = cg.backSafe;
  const inset = 18;
  const width = b.width - inset * 2;
  const top = b.y + inset + 12;
  let bottom = cg.barcode.y - inset;
  const els: Element[] = [];

  // Page thumbnails along the bottom, above the barcode.
  const thumbs = (input.thumbs ?? []).slice(0, 3);
  if (thumbs.length) {
    const gap = 14;
    const ratio = cg.trimH / cg.trimW;
    const th = Math.min(((width - gap * (thumbs.length - 1)) / thumbs.length) * ratio, (bottom - top) * 0.32);
    const tw = th / ratio;
    const x0 = b.x + inset + (width - (tw * thumbs.length + gap * (thumbs.length - 1))) / 2;
    const y = bottom - th;
    thumbs.forEach((assetId, i) => {
      const x = x0 + i * (tw + gap);
      els.push(image({ x, y, width: tw, height: th, assetId, name: "Back page thumbnail" }));
      els.push(rect({ x, y, width: tw, height: th, fill: null, stroke: color, strokeWidth: 0.75, opacity: 0.6, name: "Thumbnail border" }));
    });
    bottom = y - 18;
  }

  // "What's inside" bullets above them.
  let items = (input.inside ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const size = 10.5;
  const lh = 1.3;
  const listHeight = (list: string[]) => 13 * 1.13 * lh + 4 + list.reduce((h, s) => h + estLines(`• ${s}`, family, width, size) * size * 1.13 * lh, 0);
  while (items.length && listHeight(items) > (bottom - top) * (input.backText.trim() ? 0.5 : 1)) items = items.slice(0, -1);
  if (items.length) {
    let y = bottom - listHeight(items);
    els.push(text({ x: b.x + inset, y, width, height: 13 * 1.13 * lh, text: "What's inside", fontFamily: family, bold: true, fontSize: 13, color, lineHeight: lh, name: "Inside heading" }));
    y += 13 * 1.13 * lh + 4;
    for (const item of items) {
      const h = estLines(`• ${item}`, family, width, size) * size * 1.13 * lh;
      els.push(text({ x: b.x + inset, y, width, height: h, text: `• ${item}`, fontFamily: family, fontSize: size, color, lineHeight: lh, name: "Inside item" }));
      y += h;
    }
    bottom -= listHeight(items) + 16;
  }

  // The blurb takes the space that's left.
  if (input.backText.trim()) {
    const maxH = bottom - top;
    let fsize = 11;
    let blurb = input.backText.trim();
    while (fsize > 8 && estLines(blurb, family, width, fsize) * fsize * 1.13 * 1.35 > maxH) fsize -= 0.5;
    while (estLines(blurb, family, width, fsize) * fsize * 1.13 * 1.35 > maxH && blurb.length > 40) blurb = `${blurb.slice(0, Math.floor(blurb.length * 0.9)).replace(/\s+\S*$/, "")}…`;
    const lines = estLines(blurb, family, width, fsize);
    els.unshift(text({ x: b.x + inset, y: top, width, height: lines * fsize * 1.13 * 1.35, text: blurb, fontFamily: family, fontSize: fsize, color, lineHeight: 1.35, name: "Back blurb" }));
  }
  return els;
}

export function spineText(cg: CoverGeometry, input: CoverInput, color: string, family = "Montserrat"): Element[] {
  if (!cg.spineTextAllowed || cg.spineSafe.width < 6) return [];
  const label = [input.title, input.author].filter(Boolean).join("  ·  ").toUpperCase();
  const size = Math.min(cg.spineSafe.width * 0.62, 13, fitFontSize(label, family, cg.spineSafe.height, 1, 13, 4));
  const h = size * 1.13;
  const w = cg.spineSafe.height;
  const cx = cg.spineBox.x + cg.spineBox.width / 2;
  const cy = cg.spineBox.y + cg.spineBox.height / 2;
  return [text({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, text: label, fontFamily: family, bold: true, fontSize: size, color, align: "center", rotation: 90, lineHeight: 1, name: "Spine text" })];
}
