import type { Box, CoverGeometry } from "@/lib/kdp/geometry";
import { image, path, rect, text } from "@/lib/schema/elements";
import type { Element, TextElement } from "@/lib/schema/project";
import { textWidth } from "@/lib/render/metrics";
import { wrapText } from "@/lib/render/textLayout";
import { legibleOn, mixHex } from "@/lib/util/color";
import type { CoverInput } from "./templates";

/**
 * Text fitting and the back cover and spine shared by every cover design:
 * the built-in templates, the template library and saved templates.
 */

/** Layout measures a little wide on top of the font metrics, so text always wraps the way it was planned. */
const SAFETY = 1.01;

const measure = (family: string, bold: boolean, size: number, letterSpacing: number) => (t: string) => textWidth(t, family, bold, size, letterSpacing) * SAFETY;
const words = (s: string) => s.split(/\s+/).filter(Boolean);

export interface TextOpts {
  /** Defaults to true: titles and most cover text are set in the bold cut. */
  bold?: boolean;
  /** Extra space after each character, as a fraction of the font size. */
  letterSpacing?: number;
}

/** Lines `s` wraps to at `size` in `width`, or Infinity when a single word is too wide. */
function wrapCount(s: string, family: string, width: number, size: number, o: TextOpts = {}): number {
  const m = measure(family, o.bold ?? true, size, o.letterSpacing ?? 0);
  const ws = words(s);
  if (ws.some((w) => m(w) > width)) return Infinity;
  return wrapText(ws.join(" "), width, m).length;
}

/** Largest font size (<= max) at which `s` fits within `maxLines` lines of `width`. */
export function fitFontSize(s: string, family: string, width: number, maxLines: number, max: number, min = 10, o: TextOpts = {}): number {
  for (let size = max; size > min; size -= 1) if (wrapCount(s, family, width, size, o) <= maxLines) return size;
  return min;
}

export function estLines(s: string, family: string, width: number, size: number, o: TextOpts = {}): number {
  const n = wrapCount(s, family, width, size, o);
  // A word wider than the box still renders (on its own line); count words as a floor.
  return Number.isFinite(n) ? n : Math.max(1, words(s).length);
}

/** A last line that is one short word ("of", "the", "A") reads as a mistake in a display title. */
function orphaned(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const last = words(lines[lines.length - 1]);
  return last.length === 1 && last[0].replace(/[^\p{L}\p{N}]/gu, "").length <= 3;
}

/**
 * The narrowest box that keeps `s` on as many lines as it takes at `width`,
 * so the lines come out even instead of one long line and a stub. Every
 * renderer wraps greedily at the element's width, so a narrower box is all
 * it takes to reproduce these breaks.
 */
export function balancedWidth(s: string, family: string, size: number, width: number, o: TextOpts = {}): number {
  const m = measure(family, o.bold ?? true, size, o.letterSpacing ?? 0);
  const text = words(s).join(" ");
  const lines = (w: number) => wrapText(text, w, m);
  const target = lines(width).length;
  // One line has nothing to balance; keeping the full box leaves room for edits and saved templates.
  if (target < 2) return width;
  let lo = Math.max(...words(s).map(m));
  let hi = width;
  if (lo > hi) return width;
  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    if (lines(mid).length <= target) hi = mid;
    else lo = mid;
  }
  if (!orphaned(lines(hi))) return hi;
  for (let k = 1; k <= 16; k++) {
    const w = hi + ((width - hi) * k) / 16;
    const l = lines(w);
    if (l.length === target && !orphaned(l)) return w;
  }
  return width;
}

/** Narrow a centered multi-line text element to its balanced width, so it doesn't end on a stub. */
export function balanceElement(el: TextElement): TextElement {
  if (el.align !== "center" || el.rotation) return el;
  const o = { bold: el.bold, letterSpacing: el.letterSpacing ?? 0 };
  if (estLines(el.text, el.fontFamily, el.width, el.fontSize, o) < 2) return el;
  const w = balancedWidth(el.text, el.fontFamily, el.fontSize, el.width, o);
  return { ...el, x: el.x + (el.width - w) / 2, width: w };
}

/** Title (or other display text) fitted to `box` width at up to `max` pt, with balanced lines. */
export function titleBlock(s: string, family: string, box: Box, y: number, max: number, color: string, align: "left" | "center" = "center", maxLines = 3, o: TextOpts = {}): TextElement {
  const size = fitFontSize(s, family, box.width, maxLines, max, 10, o);
  const lines = estLines(s, family, box.width, size, o);
  const w = balancedWidth(s, family, size, box.width, o);
  const x = align === "center" ? box.x + (box.width - w) / 2 : box.x;
  return text({
    x,
    y,
    width: w,
    height: lines * size * 1.13 * 1.05,
    text: s,
    fontFamily: family,
    bold: o.bold ?? true,
    fontSize: size,
    color,
    align,
    lineHeight: 1.05,
    name: "Title",
    ...(o.letterSpacing ? { letterSpacing: o.letterSpacing } : {}),
  });
}

/** The book's face for a role (genre type system), or the template's own. */
export const face = (input: CoverInput, role: "hero" | "support" | "body", fallback: string): string => input.type?.[role] ?? fallback;

const LH = 1.13;

/** Whole sentences, so copy is only ever shortened at a sentence boundary. */
export function sentences(s: string): string[] {
  // A sentence ends at . ! or ? followed by a space, so "8.5 x 11" and "e.g." mid-word stay whole.
  return s.split(/(?<=[.!?]["')\]”’]*)\s+(?=["'“‘(]?[A-Z0-9])/).map((x) => x.trim()).filter(Boolean);
}

/** A check mark in a box `size` points square. */
const checkMark = (size: number) => `M${size * 0.08} ${size * 0.52} L${size * 0.38} ${size * 0.82} L${size * 0.92} ${size * 0.18}`;

/**
 * The back cover: a hook line, the blurb, "What's inside" as checked items on
 * a tinted panel, and page thumbnails above the barcode. When space runs
 * short the extras give way first (thumbnails' size, then list items, then
 * the thumbnails, then a smaller blurb), and the blurb is only ever
 * shortened by whole sentences, never cut off mid-word.
 */
export function backCover(cg: CoverGeometry, input: CoverInput, color: string, family = "Lora"): Element[] {
  const p = input.palette;
  const b = cg.backSafe;
  const inset = 18;
  const x = b.x + inset;
  const width = b.width - inset * 2;
  const top = b.y + inset + 6;
  const bottom = cg.barcode.y - inset;
  const avail = bottom - top;
  const k = Math.min(1.25, Math.max(0.9, b.width / 400));
  const heroFace = input.type?.hero ?? family;
  const heroBold = input.type ? input.type.heroBold : true;

  // Copy: the first sentence becomes the hook when it reads as one.
  const all = sentences(input.backText.trim());
  const hookText = all.length >= 2 && all[0].length <= 140 ? all[0] : "";
  let body = hookText ? all.slice(1) : all;
  const hookSize = hookText ? fitFontSize(hookText, heroFace, width, 3, 20 * k, 12, { bold: heroBold }) : 0;
  const hookH = hookText ? estLines(hookText, heroFace, width, hookSize, { bold: heroBold }) * hookSize * LH * 1.12 + 14 : 0;

  const thumbs = (input.thumbs ?? []).slice(0, 3);
  const ratio = cg.trimH / cg.trimW;
  const gap = 14;
  const thumbH = (share: number) => (thumbs.length ? Math.min(((width - gap * (thumbs.length - 1)) / thumbs.length) * ratio, avail * share) : 0);

  const itemSize = 10.5 * k;
  const pad = 12;
  const itemW = width - pad * 2 - itemSize * 1.5;
  const headSize = 13 * k;
  const insideH = (list: string[]) => (list.length ? pad * 2 + headSize * LH * 1.3 + 4 + list.reduce((h, it) => h + estLines(it, family, itemW, itemSize, { bold: false }) * itemSize * LH * 1.3, 0) : 0);
  const bodyH = (list: string[], size: number) => (list.length ? estLines(list.join(" "), family, width, size, { bold: false }) * size * LH * 1.35 : 0);

  const allItems = (input.inside ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  type Plan = { items: string[]; th: number; size: number; body: string[] };
  const fits = (pl: Plan) => hookH + bodyH(pl.body, pl.size) + (pl.items.length ? 16 + insideH(pl.items) : 0) + (pl.th ? pl.th + 18 : 0) <= avail;
  let plan: Plan | null = null;
  search: for (const share of [0.3, 0.22]) {
    for (let n = allItems.length; n >= 0; n--) {
      for (const size of [11 * k, 10.5 * k, 10 * k]) {
        const pl = { items: allItems.slice(0, n), th: thumbH(share), size, body };
        if (fits(pl)) {
          plan = pl;
          break search;
        }
      }
    }
  }
  if (!plan) {
    plan = { items: [], th: 0, size: 9.5, body };
    while (plan.body.length > 1 && !fits(plan)) plan.body = plan.body.slice(0, -1);
  }

  const els: Element[] = [];
  let y = top;
  if (hookText) {
    const h = estLines(hookText, heroFace, width, hookSize, { bold: heroBold }) * hookSize * LH * 1.12;
    els.push(text({ x, y, width, height: h, text: hookText, fontFamily: heroFace, bold: heroBold, fontSize: hookSize, color, lineHeight: 1.12, name: "Back hook" }));
    els.push(rect({ x, y: y + h + 5, width: 42, height: 3, fill: p.accent, name: "Back accent" }));
    y += hookH;
  }
  body = plan.body;
  if (body.length) {
    const blurb = body.join(" ");
    els.push(text({ x, y, width, height: bodyH(body, plan.size), text: blurb, fontFamily: family, fontSize: plan.size, color, lineHeight: 1.35, name: "Back blurb" }));
  }

  // Thumbnails sit on the bottom edge; the "What's inside" panel sits just above them.
  let low = bottom;
  if (plan.th) {
    const th = plan.th;
    const tw = th / ratio;
    const x0 = x + (width - (tw * thumbs.length + gap * (thumbs.length - 1))) / 2;
    thumbs.forEach((assetId, i) => {
      const tx = x0 + i * (tw + gap);
      els.push(image({ x: tx, y: bottom - th, width: tw, height: th, assetId, name: "Back page thumbnail" }));
      els.push(rect({ x: tx, y: bottom - th, width: tw, height: th, fill: null, stroke: color, strokeWidth: 0.75, opacity: 0.6, name: "Thumbnail border" }));
    });
    low = bottom - th - 18;
  }
  if (plan.items.length) {
    const h = insideH(plan.items);
    const py = low - h;
    const panel = mixHex(p.bg, color, 0.07);
    const tick = legibleOn(panel, p.accent, [color], 3);
    els.push(rect({ x, y: py, width, height: h, fill: panel, cornerRadius: 8, name: "Inside panel" }));
    let iy = py + pad;
    els.push(text({ x: x + pad, y: iy, width: width - pad * 2, height: headSize * LH * 1.3, text: "What's inside", fontFamily: heroFace, bold: heroBold, fontSize: headSize, color, lineHeight: 1.3, name: "Inside heading" }));
    iy += headSize * LH * 1.3 + 4;
    for (const item of plan.items) {
      const ih = estLines(item, family, itemW, itemSize, { bold: false }) * itemSize * LH * 1.3;
      const c = itemSize * 0.85;
      els.push(path({ x: x + pad, y: iy + (itemSize * LH * 1.3 - c) / 2, width: c, height: c, viewBoxW: c, viewBoxH: c, d: checkMark(c), fill: null, stroke: tick, strokeWidth: Math.max(1.2, c * 0.16), name: "Inside check" }));
      els.push(text({ x: x + pad + itemSize * 1.5, y: iy, width: itemW, height: ih, text: item, fontFamily: family, fontSize: itemSize, color, lineHeight: 1.3, name: "Inside item" }));
      iy += ih;
    }
  }
  return els;
}

/** Spine: the title in the cover's display face from the top, the author smaller toward the bottom. */
export function spineText(cg: CoverGeometry, input: CoverInput, color: string, family = "Montserrat"): Element[] {
  if (!cg.spineTextAllowed || cg.spineSafe.width < 6) return [];
  const s = cg.spineSafe;
  const cx = cg.spineBox.x + cg.spineBox.width / 2;
  const heroFace = input.type?.hero ?? family;
  const heroBold = input.type ? input.type.heroBold : true;
  const supportFace = input.type?.support ?? family;
  const cap = Math.min(s.width * 0.62, 14);
  const author = input.author.trim().toUpperCase();
  const authorLen = author ? s.height * 0.3 : 0;
  const titleLen = s.height - authorLen - (author ? 12 : 0);
  const title = input.title.toUpperCase();
  const size = Math.min(cap, fitFontSize(title, heroFace, titleLen, 1, cap, 4, { bold: heroBold }));
  const els: Element[] = [];
  // A rotated element turns about its center, so its unrotated width runs down the spine.
  const along = (len: number, from: number, sz: number, str: string, fam: string, bold: boolean, name: string, ls = 0) => {
    const h = sz * LH;
    const cy = from + len / 2;
    els.push(text({ x: cx - len / 2, y: cy - h / 2, width: len, height: h, text: str, fontFamily: fam, bold, fontSize: sz, color, align: "center", rotation: 90, lineHeight: 1, name, ...(ls ? { letterSpacing: ls } : {}) }));
  };
  along(titleLen, s.y, size, title, heroFace, heroBold, "Spine text");
  if (author) {
    const asize = Math.min(size * 0.75, fitFontSize(author, supportFace, authorLen, 1, size * 0.75, 4, { bold: false, letterSpacing: 0.08 }));
    along(authorLen, s.y + s.height - authorLen, asize, author, supportFace, false, "Spine author", 0.08);
  }
  return els;
}
