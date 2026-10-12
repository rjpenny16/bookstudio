import type { CoverGeometry } from "@/lib/kdp/geometry";
import { ellipse, image, pattern, rect, text } from "@/lib/schema/elements";
import type { Cover, Element } from "@/lib/schema/project";
import { createRng } from "@/lib/generators/rng";
import { legibleOn, legibleOnAll, mixHex } from "@/lib/util/color";
import { artBox, isArtTemplate, type ArtTemplateId } from "./art";
import { DESIGNS } from "./designs";
import { genreOf, type TypeSystem } from "./genres";
import { backCover, balanceElement, estLines, face, spineText } from "./layout";
import { ornament, pathIn } from "./decor";
import { textWidth } from "@/lib/render/metrics";
import { lockup } from "./lockup";
import { motifGrid, type CoverMotif } from "./motif";

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
  { id: "newsprint", name: "Newsprint", bg: "#f4efe4", fg: "#1c1c1a", accent: "#c8102e", muted: "#4a4945" },
  { id: "royal", name: "Royal", bg: "#1d3c8f", fg: "#ffffff", accent: "#ffcc29", muted: "#dbe4ff" },
  { id: "candy", name: "Candy", bg: "#fff1bd", fg: "#2b2250", accent: "#ff4f87", muted: "#4b3f72" },
  { id: "sky", name: "Sky", bg: "#d4efff", fg: "#0c2d48", accent: "#ff7a29", muted: "#2e5a7a" },
  { id: "linen", name: "Linen", bg: "#efe7dc", fg: "#2f2a25", accent: "#7f8f52", muted: "#5f5347" },
  { id: "dusk", name: "Dusk", bg: "#283552", fg: "#fdf6ec", accent: "#e8b86d", muted: "#c9cfe0" },
  { id: "ivory-gold", name: "Ivory & gold", bg: "#fbf7ef", fg: "#26231f", accent: "#a87a2c", muted: "#5f574a" },
  { id: "kraft", name: "Kraft", bg: "#c9a77c", fg: "#24180b", accent: "#f6efe3", muted: "#3f2c19" },
  { id: "slate", name: "Slate", bg: "#2f4354", fg: "#ffffff", accent: "#f2c230", muted: "#d6dde4" },
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
  /** The genre's type system; templates fall back to their own faces without one. */
  type?: TypeSystem;
  /** Title words to set largest (from the brief), when they appear in the title. */
  titleHero?: string;
  /** A piece of the book's own first puzzle, for puzzle designs. */
  motif?: CoverMotif;
  /** Seeds the decoration (flowers, circles, confetti) so each book's layout is its own. */
  seed?: number;
}

/** Height a centered subtitle takes at `size` in `width`. */
const subtitleHeight = (s: string, family: string, width: number, size: number, lh = 1.25) => estLines(s, family, width, size, { bold: false }) * size * 1.13 * lh;

function subtitleText(s: string, box: { x: number; y: number; width: number }, family: string, size: number, color: string): Element {
  return text({ x: box.x, y: box.y, width: box.width, height: subtitleHeight(s, family, box.width, size), text: s, fontFamily: family, fontSize: size, lineHeight: 1.25, color, align: "center", name: "Subtitle" });
}

/** The author centered at the foot of the front, with a short accent rule above it. */
function authorBlock(input: CoverInput, f: { x: number; y: number; width: number; height: number }, family: string, size: number, color: string, accent: string, bold: boolean): Element[] {
  if (!input.author) return [];
  const y = f.y + f.height - size * 1.13 - 14;
  return [
    rect({ x: f.x + f.width / 2 - 18, y: y - 14, width: 36, height: 2.5, fill: accent, name: "Author rule" }),
    text({ x: f.x, y, width: f.width, height: size * 1.13, text: input.author, fontFamily: family, bold, fontSize: size, letterSpacing: 0.06, color, align: "center", name: "Author" }),
  ];
}

/** The author on a rounded pill sized to it, centered at `cx`. */
function authorPill(author: string, cx: number, y: number, maxW: number, fill: string, color: string, family: string, size: number): Element[] {
  const w = Math.min(maxW, textWidth(author, family, true, size, 0.04) * 1.04 + size * 2.6);
  const h = size * 2.2;
  return [
    rect({ x: cx - w / 2, y, width: w, height: h, fill, cornerRadius: h / 2, name: "Author plate" }),
    text({ x: cx - w / 2, y: y + (h - size * 1.13) / 2, width: w, height: size * 1.13, text: author, fontFamily: family, bold: true, fontSize: size, letterSpacing: 0.04, color, align: "center", lineHeight: 1, name: "Author" }),
  ];
}

/** Distance from the trim edge to the safe area. */
const safeInset = (cg: CoverGeometry) => cg.frontSafe.y - cg.front.y;

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
      // A band hugging the title, framed by two thin rules, sitting a little above the middle.
      const inner = { ...f, x: f.x + 14, width: f.width - 28 };
      const title = lockup(input, { box: { ...inner, y: 0 }, family: "Oswald", max: 76, maxH: cg.trimH * 0.32, color: legibleOn(p.accent, p.bg, [p.fg]) });
      const bandH = title.height + 64;
      const subH = input.subtitle ? subtitleHeight(input.subtitle, face(input, "support", "Inter"), inner.width, 15) + 26 : 0;
      const bandY = cg.front.y + cg.trimH * 0.44 - (bandH + subH) / 2;
      els.push(rect({ x: fullFront.x, y: bandY, width: fullFront.width, height: bandH, fill: p.accent, name: "Band" }));
      const rule = mixHex(p.accent, p.bg, 0.35);
      els.push(rect({ x: fullFront.x, y: bandY - 11, width: fullFront.width, height: 3, fill: rule, name: "Band rule" }));
      els.push(rect({ x: fullFront.x, y: bandY + bandH + 8, width: fullFront.width, height: 3, fill: rule, name: "Band rule" }));
      title.y = bandY + (bandH - title.height) / 2;
      els.push(...title.elements);
      if (input.subtitle) els.push(subtitleText(input.subtitle, { ...inner, y: bandY + bandH + 30 }, face(input, "support", "Inter"), 15, p.fg));
      els.push(...authorBlock(input, f, face(input, "support", "Inter"), 15, p.fg, p.accent, true));
      els.push(...backCover(cg, input, p.fg, face(input, "body", "Inter")));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "framed": {
      background = p.bg;
      els.push(rect({ x: f.x + 10, y: f.y + 10, width: f.width - 20, height: f.height - 20, fill: null, stroke: p.accent, strokeWidth: 3, name: "Frame outer" }));
      els.push(rect({ x: f.x + 20, y: f.y + 20, width: f.width - 40, height: f.height - 40, fill: null, stroke: p.accent, strokeWidth: 1, name: "Frame inner" }));
      // A small diamond on each corner of the outer frame.
      for (const [cx, cy] of [[f.x + 10, f.y + 10], [f.x + f.width - 10, f.y + 10], [f.x + 10, f.y + f.height - 10], [f.x + f.width - 10, f.y + f.height - 10]]) {
        els.push(rect({ x: cx - 6, y: cy - 6, width: 12, height: 12, fill: p.bg, stroke: p.accent, strokeWidth: 2, rotation: 45, name: "Frame corner" }));
      }
      const inner = { ...f, x: f.x + 44, width: f.width - 88 };
      const title = lockup(input, { box: { ...inner, y: 0 }, family: "Playfair Display", max: 66, maxH: f.height * 0.42, color: p.fg, supportColor: legibleOn(p.bg, p.muted, [p.fg], 4.5) });
      const subFamily = face(input, "body", "Lora");
      const subH = input.subtitle ? subtitleHeight(input.subtitle, subFamily, inner.width, 15) + 14 : 0;
      const groupH = title.height + 22 + 14 + subH;
      // Optically centered: a touch above the middle of the frame.
      title.y = f.y + f.height * 0.46 - groupH / 2;
      els.push(...title.elements);
      const ow = Math.min(inner.width * 0.6, 150);
      els.push(pathIn({ x: f.x + (f.width - ow) / 2, y: title.y + title.height + 18, width: ow, height: 12 }, ornament(ow, 12), { fill: p.accent, name: "Ornament" }));
      if (input.subtitle) els.push(subtitleText(input.subtitle, { ...inner, y: title.y + title.height + 50 }, subFamily, 15, legibleOn(p.bg, p.muted, [p.fg], 4.5)));
      if (input.author) els.push(text({ x: inner.x, y: f.y + f.height - 66, width: inner.width, height: 20, text: input.author, fontFamily: subFamily, fontSize: 16, color: p.fg, align: "center", letterSpacing: 0.06, name: "Author" }));
      els.push(...backCover(cg, input, p.fg, face(input, "body", "Lora")));
      els.push(...spineText(cg, input, p.fg, "Lora"));
      break;
    }
    case "geometric": {
      // A composed set of circles: a large one off the top right, a medium one off the bottom left, a small solid accent and a ring.
      const rng = createRng((input.seed ?? input.title.length) * 7919 + 17);
      const j = () => (rng() - 0.5) * cg.trimW * 0.06;
      const W = cg.trimW;
      const H = cg.trimH;
      const fx = cg.front.x;
      const fy = cg.front.y;
      const big = W * 0.95;
      const mid = W * 0.66;
      const small = W * 0.2;
      const ring = W * 0.3;
      els.push(ellipse({ x: fx + W * 0.42 + j(), y: fy - big * 0.42 + j(), width: big, height: big, fill: mixHex(p.accent, p.bg, 0.3), name: "Circle" }));
      els.push(ellipse({ x: fx, y: fy + H - mid * 0.55 + j(), width: mid, height: mid, fill: mixHex(p.muted, p.bg, 0.7), name: "Circle" }));
      els.push(ellipse({ x: fx + W * 0.7 + j(), y: fy + H * 0.68 + j(), width: small, height: small, fill: p.accent, name: "Circle" }));
      els.push(ellipse({ x: fx + W * 0.06 + j(), y: fy + H * 0.08 + j(), width: ring, height: ring, fill: null, stroke: p.accent, strokeWidth: 5, name: "Circle" }));
      const inner = { ...f, x: f.x + 24, width: f.width - 48 };
      const title = lockup(input, { box: { ...inner, y: 0 }, family: "Montserrat", max: 62, maxH: f.height * 0.34, color: p.fg, upper: true });
      const subFamily = face(input, "support", "Inter");
      const subH = input.subtitle ? subtitleHeight(input.subtitle, subFamily, inner.width, 14) + 12 : 0;
      const plateH = title.height + 52 + subH;
      const plateY = cg.front.y + cg.trimH * 0.47 - plateH / 2;
      els.push(rect({ x: fullFront.x, y: plateY, width: fullFront.width, height: plateH, fill: p.bg, name: "Title plate" }));
      els.push(rect({ x: fullFront.x, y: plateY, width: fullFront.width, height: 4, fill: p.accent, name: "Plate rule" }));
      els.push(rect({ x: fullFront.x, y: plateY + plateH - 4, width: fullFront.width, height: 4, fill: p.accent, name: "Plate rule" }));
      title.y = plateY + 26;
      els.push(...title.elements);
      if (input.subtitle) els.push(subtitleText(input.subtitle, { ...inner, y: title.y + title.height + 12 }, subFamily, 14, p.fg));
      if (input.author) {
        const authorFamily = face(input, "support", "Montserrat");
        els.push(...authorPill(input.author, f.x + f.width / 2, f.y + f.height - 40, f.width, p.bg, p.fg, authorFamily, 14));
      }
      els.push(...backCover(cg, input, p.fg, face(input, "body", "Inter")));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "minimal": {
      // Left-aligned title against an accent rule, set on the optical center, with a quiet footer bar for the author.
      const footH = cg.front.y + cg.trimH * 0.1;
      const footY = cg.height - footH;
      const inner = { ...f, x: f.x + 34, width: f.width - 54 };
      const title = lockup(input, { box: { ...inner, y: 0 }, family: "Playfair Display", max: 76, maxH: f.height * 0.5, color: p.fg, supportColor: legibleOn(p.bg, p.muted, [p.fg], 4.5), align: "left", maxLines: 4 });
      const subFamily = face(input, "support", "Inter");
      const subH = input.subtitle ? subtitleHeight(input.subtitle, subFamily, inner.width, 15, 1.3) + 30 : 0;
      const groupH = title.height + subH;
      title.y = f.y + (footY - f.y) * 0.44 - groupH / 2;
      els.push(rect({ x: f.x + 12, y: title.y + 4, width: 6, height: groupH - 4, fill: p.accent, name: "Accent" }));
      els.push(...title.elements);
      if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 22, width: inner.width, height: subH - 30, text: input.subtitle, fontFamily: subFamily, fontSize: 15, lineHeight: 1.3, color: legibleOn(p.bg, p.muted, [p.fg], 4.5), name: "Subtitle" }));
      const foot = mixHex(p.accent, p.bg, 0.15);
      els.push(rect({ x: fullFront.x, y: footY, width: fullFront.width, height: footH, fill: foot, name: "Footer" }));
      if (input.author) els.push(text({ x: inner.x, y: footY + (Math.min(footH, cg.front.y + cg.trimH - safeInset(cg) - footY) - 18) / 2, width: inner.width, height: 18, text: input.author, fontFamily: subFamily, bold: true, fontSize: 14, letterSpacing: 0.06, color: legibleOn(foot, p.bg, [p.fg, "#ffffff", "#111111"], 4.5), name: "Author" }));
      els.push(...backCover(cg, input, p.fg, face(input, "body", "Lora")));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "playful": {
      els.push(pattern({ x: 0, y: 0, width: cg.width, height: cg.height, pattern: { kind: "dots", spacing: 18, radius: 2.2 }, stroke: p.accent, strokeWidth: 0.5, opacity: 0.35, name: "Dots" }));
      const plate = { x: f.x + 12, y: f.y + f.height * 0.22, width: f.width - 24, height: f.height * 0.42 };
      els.push(rect({ ...plate, fill: "#ffffff", stroke: p.accent, strokeWidth: 4, cornerRadius: 28, name: "Title plate" }));
      const onPlate = legibleOn("#ffffff", p.accent, [p.fg, p.bg]);
      const title = lockup(input, { box: { ...plate, x: plate.x + 20, width: plate.width - 40 }, family: "Pacifico", bold: false, supportFamily: "Inter", max: 56, maxH: plate.height - 40 - (input.subtitle ? 24 : 0), color: onPlate, supportColor: legibleOn("#ffffff", p.fg, ["#333333"], 4.5) });
      title.y = plate.y + (plate.height - title.height) / 2 - (input.subtitle ? 12 : 0);
      els.push(...title.elements);
      if (input.subtitle) els.push(text({ x: plate.x + 20, y: title.y + title.height + 6, width: plate.width - 40, height: 18, text: input.subtitle, fontFamily: face(input, "support", "Inter"), bold: true, fontSize: 12, color: "#333333", align: "center", name: "Subtitle" }));
      if (input.author) els.push(text({ x: f.x, y: f.y + f.height - 34, width: f.width, height: 18, text: input.author, fontFamily: face(input, "support", "Inter"), bold: true, fontSize: 14, color: p.fg, align: "center", name: "Author" }));
      els.push(...backCover(cg, input, p.fg, face(input, "body", "Inter")));
      els.push(...spineText(cg, input, p.fg));
      break;
    }
    case "puzzle":
    default: {
      els.push(pattern({ x: 0, y: 0, width: cg.width, height: cg.height, pattern: { kind: "grid", spacing: 24 }, stroke: p.muted, strokeWidth: 0.8, opacity: 0.25, name: "Grid" }));
      const inner = { ...f, x: f.x + 16, width: f.width - 32 };
      const title = lockup(input, { box: { ...inner, y: 0 }, family: "Anton", bold: false, supportFamily: "Oswald", max: 120, maxH: f.height * (input.motif ? 0.34 : 0.42), color: legibleOn(p.accent, p.bg, [p.fg]), upper: true, maxLines: 3 });
      const subFamily = face(input, "support", "Oswald");
      const subH = input.subtitle ? subtitleHeight(input.subtitle, subFamily, inner.width, 18) : 0;
      const bandH = title.height + 40;
      const authorTop = f.y + f.height - 44;
      // Without a puzzle to show, the band and subtitle sit together a little above the middle.
      const bandY = input.motif ? f.y + f.height * 0.08 : cg.front.y + cg.trimH * 0.44 - (bandH + 22 + subH) / 2;
      els.push(rect({ x: fullFront.x, y: bandY, width: fullFront.width, height: bandH, fill: p.accent, name: "Title band" }));
      title.y = bandY + (bandH - title.height) / 2;
      els.push(...title.elements);
      const subY = bandY + bandH + 18;
      if (input.subtitle) els.push(subtitleText(input.subtitle, { ...inner, y: subY }, subFamily, 18, p.fg));
      els.push(...authorBlock(input, f, subFamily, 16, p.fg, p.accent, true));
      // The book's own first puzzle, centered in the space between the subtitle and the author.
      if (input.motif) {
        const top = subY + (input.subtitle ? subH + 22 : 6);
        const size = Math.min(f.width * 0.74, authorTop - 14 - top);
        if (size >= f.width * 0.3) {
          const card = mixHex(p.bg, "#ffffff", 0.9);
          const box = { x: f.x + (f.width - size) / 2, y: top + (authorTop - 14 - top - size) / 2, width: size, height: size };
          els.push(rect({ x: box.x + 6, y: box.y + 6, width: size, height: size, fill: mixHex(p.bg, "#000000", 0.25), opacity: 0.5, name: "Motif shadow" }));
          els.push(...motifGrid(input.motif, box, { line: legibleOn(card, p.fg, ["#111111"]), ink: legibleOn(card, p.fg, ["#111111"], 4.5), fill: card, family: face(input, "support", "Oswald") }));
        }
      }
      els.push(...backCover(cg, input, p.fg, face(input, "body", "Inter")));
      els.push(...spineText(cg, input, p.fg, "Oswald"));
      break;
    }
  }
  return {
    background,
    templateId,
    elements: els.map((e) => (e.type === "text" && (e.name === "Subtitle" || e.name === "Author") ? balanceElement(e) : e)).map((e) =>
      e.type === "image" && e.assetId === input.art?.assetId
        ? { ...e, provenance: { origin: "ai-generated", ...(input.art.runId ? { runId: input.art.runId } : {}) } }
        : { ...e, provenance: { origin: "generated", generator: `cover:${templateId}` } },
    ),
  };
}

/**
 * A wash of `color` over art: solid (at `opacity`) from `from` to `to`, then
 * fading to clear over `fade` points below it ("down") or above it ("up").
 * The solid part, then nested rects that all start at its edge, each a
 * little longer and fainter, so the canvas, Fabric and the PDF draw it the
 * same. Abutting bands would leave a hairline seam at every step where
 * anti-aliased edges meet; nested ones share a single edge.
 */
function scrim(x: number, width: number, from: number, to: number, fade: number, color: string, opacity: number, dir: "down" | "up", name: string): Element[] {
  const steps = 32;
  const band = fade / steps;
  // Coverage wanted in fade step k (0 next to the solid part); each nested rect adds the alpha that gets it there.
  const target = (k: number) => (k >= steps ? 0 : opacity * (1 - (k + 1) / (steps + 1)));
  const els: Element[] = [rect({ x, y: from, width, height: to - from, fill: color, opacity, name })];
  for (let k = steps - 1; k >= 0; k--) {
    const len = (k + 1) * band;
    els.push(rect({ x, y: dir === "down" ? to : from - len, width, height: len, fill: color, opacity: 1 - (1 - target(k)) / (1 - target(k + 1)), name }));
  }
  return els;
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
    const title = lockup(input, { box: { ...inner, y: plateY + 18 }, family: "Playfair Display", max: 68, maxH: f.height * 0.36, color: titleColor });
    const subH = input.subtitle ? 34 : 0;
    // The title sits on a wash of the palette color that fades into the art, rather than a box on top of it.
    const full = { x: cg.front.x, width: cg.width - cg.front.x };
    els.push(...scrim(full.x, full.width, 0, plateY + title.height + 36 + subH, f.height * 0.14, p.bg, opacity, "down", "Title scrim"));
    els.push(...title.elements);
    if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 8, width: inner.width, height: 30, text: input.subtitle, fontFamily: face(input, "support", "Inter"), fontSize: 13, color: legibleOnAll(seen, p.fg, [p.muted], 4.5), align: "center", name: "Subtitle" }));
    if (input.author) {
      els.push(...scrim(full.x, full.width, f.y + f.height - 44, cg.height, f.height * 0.08, p.bg, opacity, "up", "Author scrim"));
      els.push(text({ x: f.x, y: f.y + f.height - 33, width: f.width, height: 18, text: input.author, fontFamily: face(input, "support", "Inter"), bold: true, fontSize: 14, color: legibleOnAll(seen, p.fg, [p.muted], 4.5), align: "center", name: "Author" }));
    }
  } else if (templateId === "art-panel") {
    els.push(pic);
    els.push(rect({ x: box.x, y: box.y - 5, width: box.width, height: 5, fill: p.accent, name: "Accent rule" }));
    const avail = box.y - 18 - (f.y + 10);
    const inner = { ...f, x: f.x + 12, width: f.width - 24 };
    const subH = input.subtitle ? 36 : 0;
    const title = lockup(input, { box: { ...inner, y: 0 }, family: "Oswald", max: 72, maxH: avail - subH, color: p.fg });
    title.y = f.y + 10 + (avail - title.height - subH) / 2;
    els.push(...title.elements);
    if (input.subtitle) els.push(text({ x: inner.x, y: title.y + title.height + 8, width: inner.width, height: 30, text: input.subtitle, fontFamily: "Inter", fontSize: 13, color: legibleOn(p.bg, p.muted, [p.fg], 4.5), align: "center", name: "Subtitle" }));
    if (input.author) {
      const w = Math.min(f.width, Math.max(140, input.author.length * 9 + 48));
      els.push(rect({ x: f.x + (f.width - w) / 2, y: f.y + f.height - 40, width: w, height: 30, fill: p.bg, opacity: 0.92, cornerRadius: 15, name: "Author plate" }));
      els.push(text({ x: f.x, y: f.y + f.height - 33, width: f.width, height: 18, text: input.author, fontFamily: "Inter", bold: true, fontSize: 14, color: p.fg, align: "center", name: "Author" }));
    }
  } else {
    const inner = { ...f, x: f.x + 24, width: f.width - 48 };
    const avail = box.y - 24 - (f.y + 20);
    const title = lockup(input, { box: { ...inner, y: 0 }, family: "Playfair Display", max: 60, maxH: avail, color: p.fg });
    title.y = f.y + 20 + (avail - title.height) / 2;
    els.push(...title.elements);
    els.push(rect({ x: box.x - 9, y: box.y - 9, width: box.width + 18, height: box.height + 18, fill: null, stroke: p.accent, strokeWidth: 3, name: "Art frame" }));
    els.push(pic);
    if (input.subtitle) els.push(text({ x: inner.x, y: box.y + box.height + 22, width: inner.width, height: 34, text: input.subtitle, fontFamily: "Lora", fontSize: 13, color: legibleOn(p.bg, p.muted, [p.fg], 4.5), align: "center", name: "Subtitle" }));
    if (input.author) els.push(text({ x: inner.x, y: f.y + f.height - 24, width: inner.width, height: 18, text: input.author, fontFamily: "Lora", fontSize: 15, color: p.fg, align: "center", name: "Author" }));
  }
  els.push(...backCover(cg, input, p.fg, face(input, "body", templateId === "art-panel" ? "Inter" : "Lora")));
  els.push(...spineText(cg, input, p.fg, templateId === "art-panel" ? "Oswald" : "Lora"));
  return els;
}

export function suggestTemplate(bookType: string, topic = "", audience = ""): string {
  return genreOf({ bookType, topic, audience }).templates[0];
}
