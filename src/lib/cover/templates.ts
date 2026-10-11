import type { CoverGeometry } from "@/lib/kdp/geometry";
import { ellipse, image, line, pattern, rect, text } from "@/lib/schema/elements";
import type { Cover, Element } from "@/lib/schema/project";
import { createRng } from "@/lib/generators/rng";
import { legibleOn, legibleOnAll, mixHex } from "@/lib/util/color";
import { artBox, isArtTemplate, type ArtTemplateId } from "./art";
import { DESIGNS } from "./designs";
import { backCover, fitTitle, spineText, titleBlock } from "./layout";

export { fitFontSize } from "./layout";

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
  { id: "lavender", name: "Lavender", bg: "#ece6f5", fg: "#2e2445", accent: "#8e6cc4", muted: "#5b4a7a" },
  { id: "terracotta", name: "Terracotta", bg: "#f3e3d3", fg: "#3a2418", accent: "#c8643b", muted: "#7a4b35" },
  { id: "mint", name: "Mint", bg: "#e3f6ef", fg: "#12352b", accent: "#2a9d78", muted: "#2f5d50" },
  { id: "plum", name: "Plum", bg: "#3d1e3f", fg: "#fff3f8", accent: "#f2a65a", muted: "#e8cfe0" },
];

/** Shelf a design is filed under in the template library. */
export type TemplateTag = "puzzle" | "journal" | "planner" | "kids" | "large-print" | "series" | "classic" | "modern";

export const TEMPLATE_TAGS: { id: TemplateTag; label: string }[] = [
  { id: "puzzle", label: "Puzzle & activity" },
  { id: "journal", label: "Journal & notebook" },
  { id: "planner", label: "Planner & log book" },
  { id: "kids", label: "Kids" },
  { id: "large-print", label: "Large print & seniors" },
  { id: "series", label: "Series" },
  { id: "classic", label: "Classic" },
  { id: "modern", label: "Modern" },
];

export interface CoverTemplate {
  id: string;
  name: string;
  description: string;
  tags: TemplateTag[];
  /** Uses the badge text (e.g. "200 puzzles") when there is one. */
  usesBadge?: boolean;
}

export const COVER_TEMPLATES: CoverTemplate[] = [
  { id: "band", name: "Title band", description: "Bold band across the front with centered title", tags: ["planner", "modern"] },
  { id: "framed", name: "Framed classic", description: "Double frame with serif title, timeless journal look", tags: ["journal", "classic"] },
  { id: "geometric", name: "Geometric", description: "Overlapping circles and a strong sans title", tags: ["modern", "planner"] },
  { id: "minimal", name: "Minimal", description: "Large left-aligned title with lots of space", tags: ["journal", "modern"] },
  { id: "playful", name: "Playful", description: "Script title on a dotted background, great for kids", tags: ["kids"] },
  { id: "puzzle", name: "Puzzle grid", description: "Grid texture and a heavy display title", tags: ["puzzle"] },
  { id: "color-blocks", name: "Color blocks", description: "Heavy title over a bright 3x3 mosaic with a puzzle grid", tags: ["puzzle", "kids", "large-print"] },
  { id: "botanical", name: "Botanical", description: "Title plate on a field of vector flowers, a calm gift look", tags: ["journal", "large-print", "classic"] },
  { id: "spiral", name: "Spiral-bound", description: "Coil binding look, slanted lattice panel and a round badge", tags: ["puzzle", "planner"], usesBadge: true },
  { id: "starburst", name: "Large print burst", description: "Big title plate on sun rays with a starburst badge", tags: ["large-print", "puzzle"], usesBadge: true },
  { id: "series", name: "Series ribbon", description: "Volume ribbon, header title and sunset stripes; built for a numbered series", tags: ["series", "puzzle", "journal"] },
  { id: "kids-bold", name: "Big & bright", description: "Tilted sticker title, dashed border and confetti", tags: ["kids"], usesBadge: true },
  { id: "rainbow", name: "Rainbow arcs", description: "Left-aligned serif title over soft rainbow arcs", tags: ["journal", "kids", "modern"] },
  { id: "label", name: "Vintage label", description: "Notched label with ornaments on a diamond lattice", tags: ["planner", "classic", "journal"] },
];

/** Templates built around AI cover art; they need an image. */
export const ART_COVER_TEMPLATES: CoverTemplate[] = [
  { id: "art-full-bleed", name: "Art, full bleed", description: "Artwork fills the front; title on a plate over a calm area", tags: [] },
  { id: "art-panel", name: "Art panel", description: "Title band on top, artwork below to the edge", tags: [] },
  { id: "art-framed", name: "Art in a frame", description: "Framed artwork between title and subtitle, classic and quiet", tags: [] },
];

export const templateInfo = (id: string | undefined): CoverTemplate | undefined => [...COVER_TEMPLATES, ...ART_COVER_TEMPLATES].find((t) => t.id === id);

/** Measured tone of the art where the title goes (average color, luminance spread). */
export interface ArtTone {
  mean: string;
  spread: number;
}

export interface CoverArtInput {
  assetId: string;
  /** Model run that generated the art, for provenance. */
  runId?: string;
  tone?: ArtTone;
}

export interface CoverInput {
  title: string;
  subtitle: string;
  author: string;
  backText: string;
  palette: Palette;
  /** Cover art for the art-* templates. */
  art?: CoverArtInput;
  /** "What's inside" bullets for the back cover. */
  inside?: string[];
  /** Asset ids of interior page thumbnails for the back cover (trim aspect), up to 3. */
  thumbs?: string[];
  /** Short callout for templates with a badge, e.g. "200 puzzles" or "Large print". */
  badge?: string;
  /** Series name and volume number, for the series template. */
  series?: string;
  volume?: string;
}

export function buildCover(templateId: string, input: CoverInput, cg: CoverGeometry): Pick<Cover, "background" | "elements" | "templateId"> {
  const p = input.palette;
  const f = cg.frontSafe;
  const els: Element[] = [];
  let background = p.bg;
  const fullFront = { x: cg.front.x, y: 0, width: cg.width - cg.front.x, height: cg.height };
  if (isArtTemplate(templateId) && !input.art) templateId = "minimal";

  const design = DESIGNS[templateId];
  if (design) {
    const out = design(input, cg);
    els.push(...out.elements);
    background = out.background ?? background;
  } else switch (templateId) {
    case "art-full-bleed":
    case "art-panel":
    case "art-framed":
      els.push(...artCover(templateId, input, cg));
      break;
    case "band": {
      const bandY = cg.front.y + cg.trimH * 0.3;
      const bandH = cg.trimH * 0.3;
      els.push(rect({ x: fullFront.x, y: bandY, width: fullFront.width, height: bandH, fill: p.accent, name: "Band" }));
      const title = fitTitle(input.title, "Oswald", { ...f, x: f.x + 12, width: f.width - 24 }, 64, bandH - 16, legibleOn(p.accent, p.bg, [p.fg]));
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
    elements: els.map((e) =>
      e.type === "image" && e.assetId === input.art?.assetId
        ? { ...e, provenance: { origin: "ai-generated", ...(input.art.runId ? { runId: input.art.runId } : {}) } }
        : { ...e, provenance: { origin: "generated", generator: `cover:${templateId}` } },
    ),
  };
}

/** Plate opacity over art: see-through when the art behind the title is calm, nearly solid when it's busy. */
const plateOpacity = (tone?: ArtTone) => (tone && tone.spread < 0.08 ? 0.78 : 0.9);

function artCover(templateId: ArtTemplateId, input: CoverInput, cg: CoverGeometry): Element[] {
  const p = input.palette;
  const f = cg.frontSafe;
  const art = input.art!;
  const box = artBox(templateId, cg);
  const els: Element[] = [];
  const pic = image({ ...box, assetId: art.assetId, name: "Cover art" });

  if (templateId === "art-full-bleed") {
    els.push(pic);
    const opacity = plateOpacity(art.tone);
    // What the title is actually read against: the plate with the art showing through.
    const seen = [p.bg, art.tone ? mixHex(p.bg, art.tone.mean, 1 - opacity) : p.bg];
    const titleColor = legibleOnAll(seen, p.fg, [p.accent, p.muted]);
    const inner = { ...f, x: f.x + 22, width: f.width - 44 };
    const plateY = f.y + 14;
    const title = titleBlock(input.title, "Playfair Display", inner, plateY + 18, 60, titleColor);
    const subH = input.subtitle ? 34 : 0;
    els.push(rect({ x: f.x, y: plateY, width: f.width, height: title.height + 36 + subH, fill: p.bg, opacity, cornerRadius: 8, name: "Title plate" }));
    els.push(title);
    if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 8, width: inner.width, height: 30, text: input.subtitle, fontFamily: "Inter", fontSize: 13, color: legibleOnAll(seen, p.fg, [p.muted], 4.5), align: "center", name: "Subtitle" }));
    if (input.author) {
      const w = Math.min(f.width, Math.max(140, input.author.length * 9 + 48));
      els.push(rect({ x: f.x + (f.width - w) / 2, y: f.y + f.height - 40, width: w, height: 30, fill: p.bg, opacity, cornerRadius: 15, name: "Author plate" }));
      els.push(text({ x: f.x, y: f.y + f.height - 33, width: f.width, height: 18, text: input.author, fontFamily: "Inter", bold: true, fontSize: 14, color: legibleOnAll(seen, p.fg, [p.muted], 4.5), align: "center", name: "Author" }));
    }
  } else if (templateId === "art-panel") {
    els.push(pic);
    els.push(rect({ x: box.x, y: box.y - 5, width: box.width, height: 5, fill: p.accent, name: "Accent rule" }));
    const avail = box.y - 18 - (f.y + 10);
    const inner = { ...f, x: f.x + 12, width: f.width - 24 };
    const subH = input.subtitle ? 36 : 0;
    let max = 72;
    let title = titleBlock(input.title, "Oswald", inner, 0, max, p.fg);
    while (title.height + subH > avail && max > 18) title = titleBlock(input.title, "Oswald", inner, 0, (max -= 4), p.fg);
    title.y = f.y + 10 + (avail - title.height - subH) / 2;
    els.push(title);
    if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 8, width: inner.width, height: 30, text: input.subtitle, fontFamily: "Inter", fontSize: 13, color: legibleOn(p.bg, p.muted, [p.fg], 4.5), align: "center", name: "Subtitle" }));
    if (input.author) {
      const w = Math.min(f.width, Math.max(140, input.author.length * 9 + 48));
      els.push(rect({ x: f.x + (f.width - w) / 2, y: f.y + f.height - 40, width: w, height: 30, fill: p.bg, opacity: 0.92, cornerRadius: 15, name: "Author plate" }));
      els.push(text({ x: f.x, y: f.y + f.height - 33, width: f.width, height: 18, text: input.author, fontFamily: "Inter", bold: true, fontSize: 14, color: p.fg, align: "center", name: "Author" }));
    }
  } else {
    const inner = { ...f, x: f.x + 24, width: f.width - 48 };
    const avail = box.y - 24 - (f.y + 20);
    let max = 56;
    let title = titleBlock(input.title, "Playfair Display", inner, 0, max, p.fg);
    while (title.height > avail && max > 18) title = titleBlock(input.title, "Playfair Display", inner, 0, (max -= 4), p.fg);
    title.y = f.y + 20 + (avail - title.height) / 2;
    els.push(title);
    els.push(rect({ x: box.x - 9, y: box.y - 9, width: box.width + 18, height: box.height + 18, fill: null, stroke: p.accent, strokeWidth: 3, name: "Art frame" }));
    els.push(pic);
    if (input.subtitle) els.push(text({ x: inner.x, y: box.y + box.height + 22, width: inner.width, height: 34, text: input.subtitle, fontFamily: "Lora", fontSize: 13, color: legibleOn(p.bg, p.muted, [p.fg], 4.5), align: "center", name: "Subtitle" }));
    if (input.author) els.push(text({ x: inner.x, y: f.y + f.height - 24, width: inner.width, height: 18, text: input.author, fontFamily: "Lora", fontSize: 15, color: p.fg, align: "center", name: "Author" }));
  }
  els.push(...backCover(cg, input, p.fg, templateId === "art-panel" ? "Inter" : "Lora"));
  els.push(...spineText(cg, input, p.fg, templateId === "art-panel" ? "Oswald" : "Lora"));
  return els;
}

export function suggestTemplate(bookType: string): string {
  if (bookType === "puzzle" || bookType === "activity") return "puzzle";
  if (bookType === "coloring") return "playful";
  if (bookType === "planner" || bookType === "log-book") return "band";
  if (bookType === "journal") return "framed";
  return "minimal";
}
