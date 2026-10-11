import type { Box, CoverGeometry } from "@/lib/kdp/geometry";
import { ellipse, line, pattern, rect, text } from "@/lib/schema/elements";
import type { Element, TextElement } from "@/lib/schema/project";
import { createRng } from "@/lib/generators/rng";
import { legibleOn, mixHex, shiftHue } from "@/lib/util/color";
import { circle, halfCircle, lattice, notchedRect, ornament, pathIn, petal, polygon, rays, ribbon, star } from "./decor";
import { backCover, estLines, fitFontSize, fitTitle, spineText } from "./layout";
import type { CoverInput } from "./templates";

/**
 * The template library's newer designs. Each lays out the front from the
 * book's own text and palette and reuses the shared back cover and spine.
 * Every piece of front text sits on the background or on an opaque plate, so
 * the contrast check measures what the reader actually sees.
 */

type Design = (input: CoverInput, cg: CoverGeometry) => { background?: string; elements: Element[] };

const LH = 1.13;
const textHeight = (s: string, family: string, width: number, size: number, lh = 1.16) => estLines(s, family, width, size) * size * LH * lh;
const inset = (b: Box, dx: number, dy = 0): Box => ({ x: b.x + dx, y: b.y + dy, width: b.width - dx * 2, height: b.height - dy * 2 });

function para(s: string, box: Box, family: string, size: number, color: string, opts: { bold?: boolean; align?: "left" | "center" | "right"; name: string; lh?: number }): TextElement {
  const lh = opts.lh ?? 1.16;
  return text({ x: box.x, y: box.y, width: box.width, height: textHeight(s, family, box.width, size, lh), text: s, fontFamily: family, fontSize: size, color, bold: opts.bold ?? false, align: opts.align ?? "center", lineHeight: lh, name: opts.name });
}

/** Text on a rounded pill sized to it, centered at `cx`. */
function pill(s: string, cx: number, y: number, maxW: number, fill: string, color: string, family: string, size: number, name: string): Element[] {
  const w = Math.min(maxW, s.length * size * 0.62 + size * 2.4);
  const h = size * 2.1;
  return [
    rect({ x: cx - w / 2, y, width: w, height: h, fill, cornerRadius: h / 2, name: `${name} plate` }),
    text({ x: cx - w / 2 + 6, y: y + (h - size * LH) / 2, width: w - 12, height: size * LH, text: s, fontFamily: family, bold: true, fontSize: Math.min(size, fitFontSize(s, family, w - 12, 1, size, 7)), color, align: "center", lineHeight: 1, name }),
  ];
}

const front = (cg: CoverGeometry): Box => ({ x: cg.front.x, y: 0, width: cg.width - cg.front.x, height: cg.height });
const backAndSpine = (input: CoverInput, cg: CoverGeometry, color: string, family: string, spineFamily = "Montserrat") => [...backCover(cg, input, color, family), ...spineText(cg, input, color, spineFamily)];

const colorBlocks: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const inner = inset(f, 8);
  const els: Element[] = [];
  const titleColor = legibleOn(p.bg, p.fg, [p.accent]);
  const title = fitTitle(input.title.toUpperCase(), "Anton", { ...inner, y: f.y + 6 }, 84, f.height * 0.3, titleColor);
  els.push(title);
  let y = title.y + title.height + 6;
  if (input.subtitle) {
    const sub = para(input.subtitle, { ...inner, y }, "Montserrat", 13, legibleOn(p.bg, p.muted, [p.fg], 4.5), { bold: true, name: "Subtitle" });
    els.push(sub);
    y = sub.y + sub.height;
  }
  const bottom = f.y + f.height - (input.author ? 34 : 6);
  const size = Math.max(60, Math.min(f.width - 16, bottom - (y + 14)));
  const gx = f.x + (f.width - size) / 2;
  const gy = y + 14 + (bottom - (y + 14) - size) / 2;
  const cell = size / 3;
  const rng = createRng(input.title.length * 131 + 7);
  const hues = [0, 40, 80, 130, 180, 220, 260, 300, 340].sort(() => rng() - 0.5);
  hues.forEach((h, i) => {
    const c = shiftHue(p.accent, h);
    els.push(rect({ x: gx + (i % 3) * cell, y: gy + Math.floor(i / 3) * cell, width: cell, height: cell, fill: mixHex(c, "#ffffff", i % 2 ? 0.35 : 0.12), name: "Color block" }));
  });
  els.push(pattern({ x: gx, y: gy, width: size, height: size, pattern: { kind: "grid", spacing: size / 9, majorEvery: 3 }, stroke: "#ffffff", strokeWidth: 1.4, opacity: 0.85, name: "Puzzle grid" }));
  els.push(rect({ x: gx, y: gy, width: size, height: size, fill: null, stroke: titleColor, strokeWidth: 3, name: "Grid border" }));
  if (input.author) els.push(para(input.author, { ...inner, y: f.y + f.height - 22 }, "Montserrat", 14, p.fg, { bold: true, name: "Author" }));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Inter")] };
};

const botanical: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const box = front(cg);
  const rng = createRng(input.title.length * 977 + 3);
  const petals = [p.accent, mixHex(p.accent, p.bg, 0.45), mixHex(shiftHue(p.accent, 40), p.bg, 0.15)];
  const leaf = mixHex("#4f7a52", p.bg, 0.25);
  const center = mixHex("#f2c14e", p.bg, 0.15);
  const groups: string[][] = [[], [], []];
  const leaves: string[] = [];
  const centers: string[] = [];
  const cellW = cg.trimW / 3.2;
  for (let gy = -cellW / 2; gy < box.height + cellW / 2; gy += cellW * 0.85) {
    for (let gx = 0; gx < box.width + cellW / 2; gx += cellW) {
      const r = cg.trimW * (0.07 + rng() * 0.07);
      const cx = gx + cellW / 2 + (rng() - 0.5) * cellW * 0.6;
      const cy = gy + (rng() - 0.5) * cellW * 0.5;
      // Nothing may cross the fold onto the spine.
      if (cx - r * 1.4 < 2) continue;
      const a0 = rng() * Math.PI;
      leaves.push(petal(cx, cy, r * 1.4, r * 0.32, a0 + Math.PI * 0.75), petal(cx, cy, r * 1.3, r * 0.3, a0 + Math.PI * 0.25));
      const count = 5 + Math.floor(rng() * 3);
      const g = groups[Math.floor(rng() * 3)];
      for (let k = 0; k < count; k++) g.push(petal(cx, cy, r, r * (2.2 / count), a0 + (k * Math.PI * 2) / count));
      centers.push(circle(cx, cy, r * 0.22));
    }
  }
  const els: Element[] = [pathIn(box, leaves.join(" "), { fill: leaf, name: "Leaves" })];
  groups.forEach((g, i) => g.length && els.push(pathIn(box, g.join(" "), { fill: petals[i], name: "Flowers" })));
  els.push(pathIn(box, centers.join(" "), { fill: center, name: "Flower centers" }));

  const plateW = f.width - 36;
  const px = f.x + 18;
  const titleColor = legibleOn(p.bg, p.fg, [p.accent]);
  const title = fitTitle(input.title, "Playfair Display", { x: px + 22, y: 0, width: plateW - 44, height: 0 }, 54, f.height * 0.34, titleColor);
  const sub = input.subtitle ? para(input.subtitle.toUpperCase(), { x: px + 22, y: 0, width: plateW - 44, height: 0 }, "Inter", 10.5, legibleOn(p.bg, p.muted, [p.fg], 4.5), { bold: true, name: "Subtitle", lh: 1.3 }) : null;
  const plateH = 26 + title.height + (sub ? sub.height + 14 : 0) + 26;
  const plateY = f.y + f.height * 0.42 - plateH / 2;
  els.push(rect({ x: px, y: plateY, width: plateW, height: plateH, fill: p.bg, stroke: p.accent, strokeWidth: 3, name: "Title plate" }));
  els.push(rect({ x: px + 7, y: plateY + 7, width: plateW - 14, height: plateH - 14, fill: null, stroke: p.accent, strokeWidth: 0.8, name: "Plate rule" }));
  title.y = plateY + 26;
  els.push(title);
  if (sub) {
    sub.y = title.y + title.height + 14;
    els.push(sub);
  }
  if (input.author) els.push(...pill(input.author, f.x + f.width / 2, f.y + f.height - 34, f.width, p.bg, p.fg, "Lora", 13, "Author"));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Lora", "Lora")] };
};

const spiral: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const els: Element[] = [];
  // Coil binding along the fold.
  const stripW = 26;
  els.push(rect({ x: cg.front.x, y: 0, width: stripW, height: cg.height, fill: mixHex(p.bg, p.fg, 0.12), name: "Binding strip" }));
  for (let y = 12; y < cg.height - 6; y += 20) {
    els.push(line({ x: cg.front.x + 1, y: y + 3, width: 12, height: 0, stroke: mixHex(p.fg, p.bg, 0.4), strokeWidth: 3, cap: "round", name: "Coil" }));
    els.push(ellipse({ x: cg.front.x + 11, y, width: 6, height: 6, fill: mixHex(p.fg, p.bg, 0.25), name: "Coil hole" }));
  }
  const left = Math.max(f.x, cg.front.x + stripW + 8);
  const inner: Box = { x: left, y: f.y, width: f.x + f.width - left, height: f.height };
  // Slanted panel across the lower half.
  const topL = cg.front.y + cg.trimH * 0.56;
  const topR = cg.front.y + cg.trimH * 0.44;
  const px = cg.front.x + stripW;
  const panel = { x: px, y: topR, width: cg.width - px, height: cg.height - topR };
  els.push(pathIn(panel, polygon([[0, topL - topR], [panel.width, 0], [panel.width, panel.height], [0, panel.height]]), { fill: p.accent, name: "Panel" }));
  const lat = { x: px, y: topL, width: cg.width - px, height: cg.height - topL };
  els.push(pathIn(lat, lattice(lat.width, lat.height, 26), { stroke: mixHex(p.accent, p.fg, 0.35), strokeWidth: 1.2, opacity: 0.55, name: "Lattice" }));

  const titleColor = legibleOn(p.bg, p.fg, [p.accent]);
  const title = fitTitle(input.title.toUpperCase(), "Anton", { ...inner, y: inner.y + 8 }, 80, cg.trimH * 0.28, titleColor);
  els.push(title);
  if (input.subtitle) els.push(para(input.subtitle, { ...inner, y: title.y + title.height + 8 }, "Oswald", 15, legibleOn(p.bg, p.muted, [p.fg], 4.5), { name: "Subtitle" }));
  if (input.badge) {
    const R = Math.min(inner.width * 0.19, 72);
    const cx = inner.x + inner.width - R - 4;
    const cy = cg.front.y + cg.trimH * 0.66;
    els.push(ellipse({ x: cx - R, y: cy - R, width: R * 2, height: R * 2, fill: p.bg, stroke: p.fg, strokeWidth: 3, name: "Badge" }));
    const label = input.badge.toUpperCase();
    const size = fitFontSize(label, "Oswald", R * 1.3, 3, 22, 8);
    const h = textHeight(label, "Oswald", R * 1.3, size, 1);
    els.push(text({ x: cx - R * 0.65, y: cy - h / 2, width: R * 1.3, height: h, text: label, fontFamily: "Oswald", bold: true, fontSize: size, color: legibleOn(p.bg, p.fg, [p.accent]), align: "center", lineHeight: 1, name: "Badge text" }));
  }
  if (input.author) els.push(para(input.author, { ...inner, y: f.y + f.height - 22 }, "Oswald", 16, legibleOn(p.accent, p.bg, [p.fg, "#ffffff"]), { bold: true, name: "Author", align: input.badge ? "left" : "center" }));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Inter", "Oswald")] };
};

const starburst: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const box = front(cg);
  const els: Element[] = [];
  const cx = cg.front.x + cg.trimW / 2;
  els.push(pathIn(box, rays(cx - box.x, cg.front.y + cg.trimH * 0.45, 28, { x: 0, y: 0, width: box.width, height: box.height }), { fill: mixHex(p.bg, p.accent, 0.35), opacity: 0.5, name: "Rays" }));
  // Banner along the top holds the subtitle.
  const bannerH = input.subtitle ? Math.max(cg.front.y + 46, f.y + textHeight(input.subtitle.toUpperCase(), "Oswald", f.width, 15) + 20) : 0;
  if (bannerH) {
    els.push(rect({ x: box.x, y: 0, width: box.width, height: bannerH, fill: p.fg, name: "Banner" }));
    const s = input.subtitle.toUpperCase();
    const h = textHeight(s, "Oswald", f.width, 15);
    els.push(text({ x: f.x, y: Math.max(f.y, (bannerH - h) / 2 + 4), width: f.width, height: h, text: s, fontFamily: "Oswald", bold: true, fontSize: 15, color: legibleOn(p.fg, p.bg, [p.accent, "#ffffff", "#111111"], 4.5), align: "center", lineHeight: 1.16, name: "Subtitle" }));
  }
  const plateFill = mixHex(p.bg, "#ffffff", 0.85);
  const R = input.badge ? Math.min(f.width * 0.18, 70) : 0;
  const pw = f.width - 16;
  const titleColor = legibleOn(plateFill, p.fg, [p.bg, p.accent]);
  const title = fitTitle(input.title.toUpperCase(), "Anton", { x: f.x + 26, y: 0, width: pw - 36, height: 0 }, 92, cg.trimH * 0.36, titleColor);
  const plateH = title.height + 40 + R * 0.7;
  const top = Math.max((bannerH || f.y) + 18, cg.front.y + cg.trimH * 0.46 - plateH / 2);
  els.push(rect({ x: f.x + 8, y: top, width: pw, height: plateH, fill: plateFill, stroke: p.accent, strokeWidth: 4, cornerRadius: 14, name: "Title plate" }));
  title.y = top + 20;
  els.push(title);
  if (input.badge) {
    const bx = f.x + f.width - R;
    const by = Math.min(top + plateH + R * 0.25, f.y + f.height - R - 40);
    els.push(pathIn({ x: bx - R, y: by - R, width: R * 2, height: R * 2 }, star(R, R, R, R * 0.8, 16), { fill: p.accent, name: "Starburst" }));
    const label = input.badge.toUpperCase();
    const size = fitFontSize(label, "Oswald", R * 1.15, 3, 22, 8);
    const h = textHeight(label, "Oswald", R * 1.15, size, 1);
    els.push(text({ x: bx - R * 0.575, y: by - h / 2, width: R * 1.15, height: h, text: label, fontFamily: "Oswald", bold: true, fontSize: size, color: legibleOn(p.accent, "#ffffff", [p.fg, p.bg, "#111111"]), align: "center", lineHeight: 1, name: "Badge text" }));
  }
  if (input.author) els.push(...pill(input.author, f.x + f.width / 2 - (input.badge ? R * 0.6 : 0), f.y + f.height - 34, f.width - R * 2.2, plateFill, legibleOn(plateFill, p.fg, [p.bg], 4.5), "Inter", 14, "Author"));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Inter", "Oswald")] };
};

const series: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const box = front(cg);
  const els: Element[] = [];
  const headerH = cg.front.y + cg.trimH * 0.38;
  els.push(rect({ x: box.x, y: 0, width: box.width, height: headerH, fill: p.fg, name: "Header" }));
  const rw = Math.min(f.width * 0.18, 70);
  const ribbonH = cg.front.y + cg.trimH * 0.25;
  els.push(pathIn({ x: f.x, y: 0, width: rw, height: ribbonH }, ribbon(rw, ribbonH, rw * 0.3), { fill: p.accent, name: "Ribbon" }));
  const onRibbon = legibleOn(p.accent, "#ffffff", [p.fg, p.bg, "#111111"]);
  if (input.volume) {
    els.push(text({ x: f.x, y: ribbonH - rw * 0.3 - 70, width: rw, height: 16, text: "VOL.", fontFamily: "Montserrat", bold: true, fontSize: 14, color: onRibbon, align: "center", lineHeight: 1, name: "Volume label" }));
    els.push(text({ x: f.x, y: ribbonH - rw * 0.3 - 50, width: rw, height: 40, text: input.volume, fontFamily: "Anton", fontSize: Math.min(36, rw * 0.6), color: onRibbon, align: "center", lineHeight: 1, name: "Volume" }));
  }
  const tx = f.x + rw + 14;
  const tbox: Box = { x: tx, y: 0, width: f.x + f.width - tx, height: 0 };
  const titleColor = legibleOn(p.fg, p.bg, ["#ffffff", "#111111"]);
  const title = fitTitle(input.title.toUpperCase(), "Montserrat", tbox, 60, headerH - f.y - 20, titleColor, "left", 4);
  title.y = f.y + (headerH - f.y - title.height) / 2;
  els.push(title);
  let y = headerH + 22;
  if (input.series) {
    const s = para(input.series.toUpperCase(), { ...f, y }, "Montserrat", 12, legibleOn(p.bg, p.accent, [p.muted, p.fg], 4.5), { bold: true, name: "Series" });
    els.push(s);
    y = s.y + s.height + 10;
  }
  if (input.subtitle) els.push(para(input.subtitle, { ...inset(f, 10), y }, "Lora", 16, legibleOn(p.bg, p.fg, [p.muted], 4.5), { name: "Subtitle", lh: 1.25 }));
  // Sunset stripes along the bottom.
  const stripesTop = cg.front.y + cg.trimH * 0.74;
  const bands = 5;
  const bh = (cg.height - stripesTop) / bands;
  for (let i = 0; i < bands; i++) els.push(rect({ x: box.x, y: stripesTop + i * bh, width: box.width, height: bh + 0.5, fill: mixHex(p.bg, i % 2 ? shiftHue(p.accent, -25) : p.accent, 0.35 + (i * 0.65) / (bands - 1)), name: "Stripe" }));
  if (input.author) els.push(para(input.author, { ...f, y: stripesTop - 30 }, "Montserrat", 14, p.fg, { bold: true, name: "Author" }));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Inter")] };
};

const kidsBold: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const box = front(cg);
  const els: Element[] = [];
  const angle = -3;
  const pw = f.width - 28;
  const pxl = f.x + 14;
  const titleColor = legibleOn("#ffffff", p.accent, [p.fg, "#111111"]);
  const title = fitTitle(input.title.toUpperCase(), "Anton", { x: pxl + 18, y: 0, width: pw - 36, height: 0 }, 88, cg.trimH * 0.34, titleColor);
  const plateH = title.height + 44;
  const plateY = f.y + f.height * 0.36 - plateH / 2;
  const plate = { x: pxl, y: plateY, width: pw, height: plateH };
  const subH = input.subtitle ? 30 : 0;
  const subY = plateY + plateH + 22;
  // Confetti, kept clear of the plate, the subtitle and the author.
  const rng = createRng(input.title.length * 313 + 11);
  const R = input.badge ? Math.min(f.width * 0.17, 64) : 0;
  const authorY = f.y + f.height - 40;
  const badge = { cx: f.x + f.width - R - 10, cy: (subY + subH + authorY) / 2 };
  const keepOut: Box[] = [inset(plate, -14, -14), { x: f.x, y: subY - 6, width: f.width, height: subH + 12 }, { x: f.x, y: authorY - 4, width: f.width, height: 50 }, { x: badge.cx - R - 6, y: badge.cy - R - 6, width: R * 2 + 12, height: R * 2 + 12 }];
  const dots: string[][] = [[], [], []];
  for (let i = 0; i < 70; i++) {
    const r = 3 + rng() * 6;
    const x = 4 + r + rng() * (box.width - 8 - r * 2);
    const y = r + rng() * (box.height - r * 2);
    if (keepOut.some((k) => x + box.x > k.x - r && x + box.x < k.x + k.width + r && y > k.y - r && y < k.y + k.height + r)) continue;
    dots[i % 3].push(i % 7 === 0 ? star(x, y, r * 1.6, r * 0.7, 5) : circle(x, y, r));
  }
  [p.accent, shiftHue(p.accent, 120), shiftHue(p.accent, 240)].forEach((c, i) => dots[i].length && els.push(pathIn(box, dots[i].join(" "), { fill: c, opacity: 0.85, name: "Confetti" })));
  // Dashed border inside the safe area.
  const b = inset(f, 2, 2);
  const dash = { stroke: p.fg, strokeWidth: 2.5, dash: [9, 6], name: "Dashed border" };
  els.push(line({ x: b.x, y: b.y, width: b.width, height: 0, ...dash }), line({ x: b.x, y: b.y + b.height, width: b.width, height: 0, ...dash }), line({ x: b.x, y: b.y, width: 0, height: b.height, ...dash }), line({ x: b.x + b.width, y: b.y, width: 0, height: b.height, ...dash }));
  // Sticker title with a solid drop shadow.
  els.push(rect({ ...plate, x: plate.x + 7, y: plate.y + 7, fill: p.fg, cornerRadius: 18, rotation: angle, name: "Plate shadow" }));
  els.push(rect({ ...plate, fill: "#ffffff", stroke: p.fg, strokeWidth: 3, cornerRadius: 18, rotation: angle, name: "Title plate" }));
  title.y = plateY + (plateH - title.height) / 2;
  title.rotation = angle;
  els.push(title);
  if (input.subtitle) els.push(...pill(input.subtitle, f.x + f.width / 2, subY, f.width - 20, p.fg, legibleOn(p.fg, p.bg, ["#ffffff", "#111111"], 4.5), "Inter", 13, "Subtitle"));
  if (input.badge) {
    const { cx, cy } = badge;
    els.push(pathIn({ x: cx - R, y: cy - R, width: R * 2, height: R * 2 }, star(R, R, R, R * 0.78, 14), { fill: p.accent, name: "Starburst" }));
    const label = input.badge.toUpperCase();
    const size = fitFontSize(label, "Oswald", R * 1.1, 3, 18, 7);
    const h = textHeight(label, "Oswald", R * 1.1, size, 1);
    els.push(text({ x: cx - R * 0.55, y: cy - h / 2, width: R * 1.1, height: h, text: label, fontFamily: "Oswald", bold: true, fontSize: size, color: legibleOn(p.accent, "#ffffff", [p.fg, "#111111"]), align: "center", lineHeight: 1, name: "Badge text" }));
  }
  if (input.author) els.push(...pill(input.author, f.x + f.width / 2, authorY, f.width - 20, "#ffffff", legibleOn("#ffffff", p.fg, ["#111111"], 4.5), "Inter", 13, "Author"));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Inter")] };
};

const rainbow: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const els: Element[] = [];
  const R = cg.trimW * 0.44;
  const band = R * 0.12;
  const cx = cg.front.x + cg.trimW / 2;
  const colors = [p.accent, shiftHue(p.accent, 25), mixHex(p.accent, p.fg, 0.4), mixHex(p.accent, p.bg, 0.45)];
  colors.forEach((c, i) => {
    const r = R - i * band;
    // The outer arc's stroke just touches the box, so the box (plus half a stroke) stays off the spine.
    els.push(pathIn({ x: cx - R, y: cg.height - R, width: R * 2, height: R }, halfCircle(R, R, r - band / 2), { stroke: c, strokeWidth: band, name: "Arc" }));
  });
  const inner = inset(f, 14);
  const arcTop = cg.height - R;
  let y = f.y + 10;
  if (input.author) {
    const a = para(input.author.toUpperCase(), { ...inner, y }, "Inter", 11, legibleOn(p.bg, p.muted, [p.fg], 4.5), { bold: true, align: "left", name: "Author" });
    els.push(a);
    y = a.y + a.height + 18;
  }
  const subH = input.subtitle ? textHeight(input.subtitle, "Inter", inner.width, 14, 1.3) + 22 : 0;
  const title = fitTitle(input.title, "Playfair Display", { ...inner, y }, 64, arcTop - 24 - y - subH, legibleOn(p.bg, p.fg, [p.accent]), "left", 5);
  els.push(title);
  els.push(rect({ x: inner.x, y: title.y + title.height + 10, width: 48, height: 4, fill: p.accent, name: "Accent" }));
  if (input.subtitle) els.push(para(input.subtitle, { ...inner, y: title.y + title.height + 24 }, "Inter", 14, legibleOn(p.bg, p.muted, [p.fg], 4.5), { align: "left", name: "Subtitle", lh: 1.3 }));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Lora")] };
};

const label: Design = (input, cg) => {
  const p = input.palette;
  const f = cg.frontSafe;
  const box = front(cg);
  const els: Element[] = [pathIn(box, lattice(box.width, box.height, 22), { stroke: mixHex(p.bg, p.fg, 0.18), strokeWidth: 0.8, name: "Lattice" })];
  const lw = f.width - 30;
  const lx = f.x + 15;
  const fill = mixHex(p.bg, "#ffffff", 0.8);
  const ink = legibleOn(fill, p.fg, [p.bg, "#111111"]);
  const accentInk = legibleOn(fill, p.accent, [ink]);
  const title = fitTitle(input.title, "Playfair Display", { x: lx + 34, y: 0, width: lw - 68, height: 0 }, 50, cg.trimH * 0.3, ink);
  const sub = input.subtitle ? para(input.subtitle, { x: lx + 34, y: 0, width: lw - 68, height: 0 }, "Lora", 13, legibleOn(fill, p.muted, [ink], 4.5), { name: "Subtitle", lh: 1.3 }) : null;
  const lh = 38 + 12 + 16 + title.height + 16 + 12 + (sub ? sub.height + 14 : 0) + 34;
  const ly = f.y + f.height * 0.44 - lh / 2;
  els.push(pathIn({ x: lx, y: ly, width: lw, height: lh }, notchedRect(lw, lh, 22), { fill, stroke: p.accent, strokeWidth: 2.5, name: "Label" }));
  els.push(pathIn({ x: lx + 8, y: ly + 8, width: lw - 16, height: lh - 16 }, notchedRect(lw - 16, lh - 16, 16), { stroke: accentInk, strokeWidth: 0.8, name: "Label rule" }));
  let y = ly + 38;
  els.push(pathIn({ x: lx + lw * 0.25, y, width: lw * 0.5, height: 12 }, ornament(lw * 0.5, 12), { fill: accentInk, name: "Ornament" }));
  y += 12 + 16;
  title.y = y;
  els.push(title);
  y += title.height + 16;
  els.push(pathIn({ x: lx + lw * 0.25, y, width: lw * 0.5, height: 12 }, ornament(lw * 0.5, 12), { fill: accentInk, name: "Ornament" }));
  y += 12 + 14;
  if (sub) {
    sub.y = y;
    els.push(sub);
  }
  if (input.author) els.push(...pill(input.author, f.x + f.width / 2, f.y + f.height - 36, f.width, fill, ink, "Lora", 14, "Author"));
  return { elements: [...els, ...backAndSpine(input, cg, p.fg, "Lora", "Lora")] };
};

export const DESIGNS: Record<string, Design> = {
  "color-blocks": colorBlocks,
  botanical,
  spiral,
  starburst,
  series,
  "kids-bold": kidsBold,
  rainbow,
  label,
};
