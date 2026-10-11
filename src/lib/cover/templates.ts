import type { Box, CoverGeometry } from "@/lib/kdp/geometry";
import { ellipse, line, pattern, rect, text } from "@/lib/schema/elements";
import type { Cover, Element } from "@/lib/schema/project";
import { createRng } from "@/lib/generators/rng";
import { legibleOn } from "@/lib/util/color";

export interface Palette {
  id: string;
  name: string;
  bg: string;
  fg: string;
  accent: string;
  muted: string;
}

export const PALETTES: Palette[] = [
  { id: "midnight", name: "Midnight", bg: "#14213d", fg: "#ffffff", accent: "#fca311", muted: "#e5e5e5" },
  { id: "sage", name: "Sage", bg: "#dfe7dc", fg: "#23312b", accent: "#6b8f71", muted: "#3f5247" },
  { id: "blush", name: "Blush", bg: "#f6e4e1", fg: "#3b2a2a", accent: "#d17a6f", muted: "#7a5c58" },
  { id: "ocean", name: "Ocean", bg: "#0b4f6c", fg: "#ffffff", accent: "#01baef", muted: "#d9f1fa" },
  { id: "sunny", name: "Sunny", bg: "#ffd166", fg: "#1f1f1f", accent: "#ef476f", muted: "#3d3d3d" },
  { id: "forest", name: "Forest", bg: "#1b4332", fg: "#f1faee", accent: "#95d5b2", muted: "#d8f3dc" },
  { id: "charcoal", name: "Charcoal", bg: "#2b2d42", fg: "#edf2f4", accent: "#ef233c", muted: "#8d99ae" },
  { id: "cream", name: "Cream", bg: "#f8f1e3", fg: "#2d2a26", accent: "#b5838d", muted: "#6d6875" },
];

export interface CoverTemplate {
  id: string;
  name: string;
  description: string;
}

export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: "band", name: "Title band", description: "Bold band across the front with centered title" },
  { id: "framed", name: "Framed classic", description: "Double frame with serif title, timeless journal look" },
  { id: "geometric", name: "Geometric", description: "Overlapping circles and a strong sans title" },
  { id: "minimal", name: "Minimal", description: "Large left-aligned title with lots of space" },
  { id: "playful", name: "Playful", description: "Script title on a dotted background, great for kids" },
  { id: "puzzle", name: "Puzzle grid", description: "Grid texture and a heavy display title" },
];

export interface CoverInput {
  title: string;
  subtitle: string;
  author: string;
  backText: string;
  palette: Palette;
}

const CHAR_FACTOR: Record<string, number> = {
  Inter: 0.56,
  Montserrat: 0.6,
  Oswald: 0.44,
  "Anton": 0.4,
  Merriweather: 0.6,
  Lora: 0.53,
  "Playfair Display": 0.53,
  Pacifico: 0.62,
  Caveat: 0.42,
  "Roboto Mono": 0.6,
};

/** Largest font size (<= max) at which `s` fits within `maxLines` lines of `width`. */
export function fitFontSize(s: string, family: string, width: number, maxLines: number, max: number, min = 10): number {
  const factor = CHAR_FACTOR[family] ?? 0.56;
  const words = s.split(/\s+/).filter(Boolean);
  for (let size = max; size > min; size -= 1) {
    const charW = size * factor;
    let lines = 1;
    let cur = 0;
    let ok = true;
    for (const w of words) {
      const len = w.length * charW;
      if (len > width) {
        ok = false;
        break;
      }
      const next = cur === 0 ? len : cur + charW + len;
      if (next > width) {
        lines++;
        cur = len;
      } else cur = next;
    }
    if (ok && lines <= maxLines) return size;
  }
  return min;
}

function estLines(s: string, family: string, width: number, size: number): number {
  const factor = CHAR_FACTOR[family] ?? 0.56;
  const words = s.split(/\s+/).filter(Boolean);
  let lines = 1;
  let cur = 0;
  for (const w of words) {
    const len = w.length * size * factor;
    const next = cur === 0 ? len : cur + size * factor + len;
    if (next > width && cur > 0) {
      lines++;
      cur = len;
    } else cur = next;
  }
  return lines;
}

function titleBlock(s: string, family: string, box: Box, y: number, max: number, color: string, align: "left" | "center" = "center", maxLines = 3): Element {
  const size = fitFontSize(s, family, box.width, maxLines, max);
  const lines = estLines(s, family, box.width, size);
  return text({ x: box.x, y, width: box.width, height: lines * size * 1.13 * 1.05, text: s, fontFamily: family, bold: true, fontSize: size, color, align, lineHeight: 1.05, name: "Title" });
}

function backCover(cg: CoverGeometry, input: CoverInput, color: string, family = "Lora"): Element[] {
  if (!input.backText.trim()) return [];
  const b = cg.backSafe;
  const inset = 18;
  const maxH = cg.barcode.y - b.y - inset * 2;
  const width = b.width - inset * 2;
  let size = 11;
  let blurb = input.backText.trim();
  while (size > 8 && estLines(blurb, family, width, size) * size * 1.13 * 1.35 > maxH) size -= 0.5;
  while (estLines(blurb, family, width, size) * size * 1.13 * 1.35 > maxH && blurb.length > 40) blurb = `${blurb.slice(0, Math.floor(blurb.length * 0.9)).replace(/\s+\S*$/, "")}…`;
  const lines = estLines(blurb, family, width, size);
  return [text({ x: b.x + inset, y: b.y + inset + 12, width, height: lines * size * 1.13 * 1.35, text: blurb, fontFamily: family, fontSize: size, color, lineHeight: 1.35, name: "Back blurb" })];
}

function spineText(cg: CoverGeometry, input: CoverInput, color: string, family = "Montserrat"): Element[] {
  if (!cg.spineTextAllowed || cg.spineSafe.width < 6) return [];
  const label = [input.title, input.author].filter(Boolean).join("  ·  ").toUpperCase();
  const size = Math.min(cg.spineSafe.width * 0.62, 13, fitFontSize(label, family, cg.spineSafe.height, 1, 13, 4));
  const h = size * 1.13;
  const w = cg.spineSafe.height;
  const cx = cg.spineBox.x + cg.spineBox.width / 2;
  const cy = cg.spineBox.y + cg.spineBox.height / 2;
  return [text({ x: cx - w / 2, y: cy - h / 2, width: w, height: h, text: label, fontFamily: family, bold: true, fontSize: size, color, align: "center", rotation: 90, lineHeight: 1, name: "Spine text" })];
}

export function buildCover(templateId: string, input: CoverInput, cg: CoverGeometry): Pick<Cover, "background" | "elements" | "templateId"> {
  const p = input.palette;
  const f = cg.frontSafe;
  const els: Element[] = [];
  let background = p.bg;
  const fullFront = { x: cg.front.x, y: 0, width: cg.width - cg.front.x, height: cg.height };

  switch (templateId) {
    case "band": {
      const bandY = cg.front.y + cg.trimH * 0.3;
      const bandH = cg.trimH * 0.3;
      els.push(rect({ x: fullFront.x, y: bandY, width: fullFront.width, height: bandH, fill: p.accent, name: "Band" }));
      const title = titleBlock(input.title, "Oswald", { ...f, x: f.x + 12, width: f.width - 24 }, 0, 64, legibleOn(p.accent, p.bg, [p.fg]));
      title.y = bandY + (bandH - title.height) / 2;
      els.push(title);
      if (input.subtitle) els.push(text({ x: f.x + 12, y: bandY + bandH + 20, width: f.width - 24, height: 40, text: input.subtitle, fontFamily: "Inter", fontSize: 14, color: p.fg, align: "center", name: "Subtitle" }));
      if (input.author) els.push(text({ x: f.x, y: f.y + f.height - 40, width: f.width, height: 18, text: input.author, fontFamily: "Inter", bold: true, fontSize: 15, color: p.fg, align: "center", name: "Author" }));
      els.push(...backCover(cg, input, p.fg, "Inter"));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "framed": {
      background = p.bg;
      els.push(rect({ x: f.x + 10, y: f.y + 10, width: f.width - 20, height: f.height - 20, fill: null, stroke: p.accent, strokeWidth: 3, name: "Frame outer" }));
      els.push(rect({ x: f.x + 20, y: f.y + 20, width: f.width - 40, height: f.height - 40, fill: null, stroke: p.accent, strokeWidth: 1, name: "Frame inner" }));
      const inner = { ...f, x: f.x + 40, width: f.width - 80 };
      const title = titleBlock(input.title, "Playfair Display", inner, f.y + f.height * 0.3, 54, p.fg);
      els.push(title);
      els.push(line({ x: f.x + f.width / 2 - 40, y: title.y + title.height + 16, width: 80, height: 0, stroke: p.accent, strokeWidth: 2 }));
      if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 32, width: inner.width, height: 40, text: input.subtitle, fontFamily: "Lora", fontSize: 14, color: p.muted, align: "center", name: "Subtitle" }));
      if (input.author) els.push(text({ x: inner.x, y: f.y + f.height - 70, width: inner.width, height: 18, text: input.author, fontFamily: "Lora", fontSize: 15, color: p.fg, align: "center", name: "Author" }));
      els.push(...backCover(cg, input, p.fg));
      els.push(...spineText(cg, input, p.fg, "Lora"));
      break;
    }
    case "geometric": {
      const rng = createRng(input.title.length * 7919 + 17);
      for (let i = 0; i < 7; i++) {
        const d = cg.trimW * (0.25 + rng() * 0.45);
        els.push(ellipse({ x: cg.front.x + rng() * cg.trimW - d / 2, y: cg.front.y + rng() * cg.trimH - d / 2, width: d, height: d, fill: i % 2 ? p.accent : p.muted, opacity: 0.35, name: "Circle" }));
      }
      const plateY = f.y + f.height * 0.38;
      const title = titleBlock(input.title.toUpperCase(), "Montserrat", { ...f, x: f.x + 24, width: f.width - 48 }, plateY + 18, 52, p.fg);
      els.push(rect({ x: f.x, y: plateY, width: f.width, height: title.height + 36 + (input.subtitle ? 30 : 0), fill: p.bg, opacity: 0.92, cornerRadius: 6, name: "Title plate" }));
      els.push(title);
      if (input.subtitle) els.push(text({ x: f.x + 24, y: title.y + title.height + 8, width: f.width - 48, height: 18, text: input.subtitle, fontFamily: "Inter", fontSize: 13, color: p.fg, align: "center", name: "Subtitle" }));
      if (input.author) els.push(text({ x: f.x, y: f.y + f.height - 34, width: f.width, height: 18, text: input.author, fontFamily: "Montserrat", bold: true, fontSize: 14, color: p.fg, align: "center", name: "Author" }));
      els.push(...backCover(cg, input, p.fg, "Inter"));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "minimal": {
      const inner = { ...f, x: f.x + 20, width: f.width - 40 };
      const title = titleBlock(input.title, "Playfair Display", inner, f.y + 50, 60, p.fg, "left", 4);
      els.push(title);
      els.push(rect({ x: inner.x, y: title.y + title.height + 18, width: 60, height: 4, fill: p.accent, name: "Accent" }));
      if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 36, width: inner.width, height: 40, text: input.subtitle, fontFamily: "Inter", fontSize: 13, color: p.muted, name: "Subtitle" }));
      if (input.author) els.push(text({ x: inner.x, y: f.y + f.height - 40, width: inner.width, height: 18, text: input.author, fontFamily: "Inter", fontSize: 14, color: p.fg, name: "Author" }));
      els.push(...backCover(cg, input, p.fg));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "playful": {
      els.push(pattern({ x: 0, y: 0, width: cg.width, height: cg.height, pattern: { kind: "dots", spacing: 18, radius: 2.2 }, stroke: p.accent, strokeWidth: 0.5, opacity: 0.35, name: "Dots" }));
      const plate = { x: f.x + 12, y: f.y + f.height * 0.22, width: f.width - 24, height: f.height * 0.42 };
      els.push(rect({ ...plate, fill: "#ffffff", stroke: p.accent, strokeWidth: 4, cornerRadius: 28, name: "Title plate" }));
      const title = titleBlock(input.title, "Pacifico", { ...plate, x: plate.x + 20, width: plate.width - 40 }, 0, 48, legibleOn("#ffffff", p.accent, [p.fg, p.bg]));
      title.y = plate.y + (plate.height - title.height) / 2 - (input.subtitle ? 12 : 0);
      els.push(title);
      if (input.subtitle) els.push(text({ x: plate.x + 20, y: title.y + title.height + 6, width: plate.width - 40, height: 18, text: input.subtitle, fontFamily: "Inter", bold: true, fontSize: 12, color: "#333333", align: "center", name: "Subtitle" }));
      if (input.author) els.push(text({ x: f.x, y: f.y + f.height - 34, width: f.width, height: 18, text: input.author, fontFamily: "Inter", bold: true, fontSize: 14, color: p.fg, align: "center", name: "Author" }));
      els.push(...backCover(cg, input, p.fg, "Inter"));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "puzzle":
    default: {
      els.push(pattern({ x: 0, y: 0, width: cg.width, height: cg.height, pattern: { kind: "grid", spacing: 24 }, stroke: p.muted, strokeWidth: 0.8, opacity: 0.25, name: "Grid" }));
      const plateY = f.y + f.height * 0.18;
      const title = titleBlock(input.title.toUpperCase(), "Anton", { ...f, x: f.x + 16, width: f.width - 32 }, plateY + 16, 96, legibleOn(p.accent, p.bg, [p.fg]), "center", 3);
      els.push(rect({ x: fullFront.x, y: plateY, width: fullFront.width, height: title.height + 32, fill: p.accent, name: "Title band" }));
      els.push(title);
      if (input.subtitle) els.push(text({ x: f.x + 16, y: plateY + title.height + 48, width: f.width - 32, height: 40, text: input.subtitle, fontFamily: "Oswald", fontSize: 18, color: p.fg, align: "center", name: "Subtitle" }));
      if (input.author) els.push(text({ x: f.x, y: f.y + f.height - 36, width: f.width, height: 18, text: input.author, fontFamily: "Oswald", fontSize: 16, color: p.fg, align: "center", name: "Author" }));
      els.push(...backCover(cg, input, p.fg, "Inter"));
      els.push(...spineText(cg, input, p.fg, "Oswald"));
      break;
    }
  }
  return {
    background,
    templateId,
    elements: els.map((e) => ({ ...e, provenance: { origin: "generated", generator: `cover:${templateId}` } })),
  };
}

export function suggestTemplate(bookType: string): string {
  if (bookType === "puzzle" || bookType === "activity") return "puzzle";
  if (bookType === "coloring") return "playful";
  if (bookType === "planner" || bookType === "log-book") return "band";
  if (bookType === "journal") return "framed";
  return "minimal";
}
