import type { CoverGeometry } from "@/lib/kdp/geometry";
import { elementBounds } from "@/lib/schema/elements";
import type { Asset, Cover, Element, Project, TextElement } from "@/lib/schema/project";
import { legibleOn } from "@/lib/util/color";
import { newId, ptToIn } from "@/lib/util/ids";
import { backCover, estLines, spineText } from "./layout";
import type { CoverInput } from "./templates";

/**
 * Saved cover templates: a finished cover kept as a reusable design, so a
 * publisher can give every book in a series (or a whole niche) the same look
 * with different interiors. Saving strips what belongs to one book (the back
 * blurb, "What's inside", page thumbnails, spine text); applying maps every
 * element onto the new book's cover size, swaps in its title, subtitle,
 * author, series and badge, and rebuilds the back cover and spine.
 */

export const SAVED_TEMPLATE_KIND = "bookstudio-cover-template";
export const SAVED_TEMPLATE_PREFIX = "saved:";

export interface TextStyle {
  color: string;
  family: string;
}

export interface SavedCoverTemplate {
  kind: typeof SAVED_TEMPLATE_KIND;
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  /** Front-cover preview, a PNG or JPEG data URL. */
  preview?: string;
  /** Size of the cover it was saved from, in points. */
  source: { trimW: number; trimH: number; spine: number; bleed: number };
  /** Template and palette the design started from, for reference. */
  baseTemplateId?: string;
  paletteId?: string;
  background: string;
  barcode: Cover["barcode"];
  elements: Element[];
  /** Images the elements use (cover art, logos), carried with the template. */
  assets: Asset[];
  back: TextStyle;
  spine: TextStyle;
}

/** Elements that describe one particular book; rebuilt for each book a template is applied to. */
const BOOK_SPECIFIC = new Set(["Back blurb", "Inside heading", "Inside item", "Back page thumbnail", "Thumbnail border", "Spine text"]);

/** Text elements whose words come from the book, by element name. */
type Role = "title" | "subtitle" | "author" | "series" | "volume" | "badge";
const ROLES: Record<string, Role> = { Title: "title", Subtitle: "subtitle", Author: "author", Series: "series", Volume: "volume", "Badge text": "badge" };
/** Shapes that only exist to carry a role's text; dropped with it when the new book has none. */
const COMPANIONS: Record<Role, string[]> = {
  title: [],
  subtitle: ["Subtitle plate"],
  author: ["Author plate"],
  series: [],
  volume: ["Volume label"],
  badge: ["Badge", "Starburst"],
};

export const isSavedTemplateId = (id: string | undefined) => Boolean(id?.startsWith(SAVED_TEMPLATE_PREFIX));

/** Keep the current cover as a reusable template. */
export function captureCoverTemplate(project: Project, cg: CoverGeometry, name: string, preview?: string): SavedCoverTemplate {
  const els = project.cover.elements;
  const styleOf = (names: string[], fallbackFamily: string): TextStyle => {
    const t = els.find((e): e is TextElement => e.type === "text" && names.includes(e.name ?? ""));
    return t ? { color: t.color, family: t.fontFamily } : { color: legibleOn(project.cover.background, "#111111", ["#ffffff"], 4.5), family: fallbackFamily };
  };
  const elements = structuredClone(els.filter((e) => !BOOK_SPECIFIC.has(e.name ?? "")));
  const used = new Set(elements.flatMap((e) => (e.type === "image" ? [e.assetId] : [])));
  return {
    kind: SAVED_TEMPLATE_KIND,
    version: 1,
    id: newId("tpl"),
    name: name.trim() || project.metadata.title || project.name,
    createdAt: new Date().toISOString(),
    ...(preview ? { preview } : {}),
    source: { trimW: cg.trimW, trimH: cg.trimH, spine: cg.spine, bleed: cg.bleed },
    ...(project.cover.templateId && !isSavedTemplateId(project.cover.templateId) ? { baseTemplateId: project.cover.templateId } : {}),
    ...(project.cover.paletteId ? { paletteId: project.cover.paletteId } : {}),
    background: project.cover.background,
    barcode: project.cover.barcode,
    elements,
    assets: structuredClone(project.assets.filter((a) => used.has(a.id))),
    back: styleOf(["Back blurb", "Inside heading", "Inside item"], "Lora"),
    spine: styleOf(["Spine text"], "Montserrat"),
  };
}

interface Frame {
  width: number;
  height: number;
  /** Right edge of the back panel and left edge of the front panel. */
  backEnd: number;
  spineEnd: number;
}

const frameOf = (s: { trimW: number; trimH: number; spine: number; bleed: number }): Frame => ({
  width: s.bleed * 2 + s.trimW * 2 + s.spine,
  height: s.bleed * 2 + s.trimH,
  backEnd: s.bleed + s.trimW,
  spineEnd: s.bleed + s.trimW + s.spine,
});

/** Map an element from one cover size to another, panel by panel. */
function remap(el: Element, a: Frame, b: Frame): Element {
  const ky = b.height / a.height;
  const kFront = (b.width - b.spineEnd) / (a.width - a.spineEnd);
  const kBack = b.backEnd / a.backEnd;
  const aSpine = a.spineEnd - a.backEnd;
  const bSpine = b.spineEnd - b.backEnd;
  const kSpine = aSpine > 0.01 ? bSpine / aSpine : 1;
  const xFront = (x: number) => b.spineEnd + (x - a.spineEnd) * kFront;
  const xBack = (x: number) => x * kBack;
  const xSpine = (x: number) => (b.backEnd + b.spineEnd) / 2 + (x - (a.backEnd + a.spineEnd) / 2) * kSpine;

  const left = Math.min(el.x, el.x + el.width);
  const right = Math.max(el.x, el.x + el.width);
  const cx = el.x + el.width / 2;
  let X: (x: number) => number;
  let kx: number;
  let panelW: number;
  if (left <= a.backEnd + 0.5 && right >= a.spineEnd - 0.5 && !el.rotation) {
    // Spans the spine (full-wrap backgrounds, bands): stretch to the same edges.
    const nl = el.x <= a.backEnd ? xBack(el.x) : xFront(el.x);
    const xr = el.x + el.width;
    const nr = xr >= a.spineEnd ? xFront(xr) : xBack(xr);
    return { ...el, x: nl, y: el.y * ky, width: nr - nl, height: el.height * ky, ...(el.type === "text" ? { fontSize: el.fontSize * Math.min(kFront, ky) } : {}) };
  } else if (cx >= a.spineEnd) [X, kx, panelW] = [xFront, kFront, a.width - a.spineEnd];
  else if (cx <= a.backEnd) [X, kx, panelW] = [xBack, kBack, a.backEnd];
  else [X, kx, panelW] = [xSpine, kSpine, aSpine];

  const s = Math.min(kx, ky);
  const fills = Math.abs(el.width) >= panelW * 0.9;
  // Shapes that would look wrong squashed keep their proportions unless they fill the panel.
  const uniform = !fills && (el.type === "ellipse" || el.type === "path");
  if (uniform) {
    const ncx = X(cx);
    const ncy = (el.y + el.height / 2) * ky;
    return { ...el, x: ncx - (el.width * s) / 2, y: ncy - (el.height * s) / 2, width: el.width * s, height: el.height * s, ...("strokeWidth" in el ? { strokeWidth: el.strokeWidth * s } : {}) };
  }
  const nx = X(el.x);
  const out = { ...el, x: nx, y: el.y * ky, width: X(el.x + el.width) - nx, height: el.height * ky };
  if (out.type === "text") out.fontSize = el.type === "text" ? el.fontSize * s : 12;
  if (out.type === "rect" && el.type === "rect") out.cornerRadius = el.cornerRadius * s;
  return out;
}

/** Put new words in a text box: the largest size up to the old one that fits, centered where the old text was. */
function retext(el: TextElement, words: string): TextElement {
  const upper = /[A-Za-z]/.test(el.text) && el.text === el.text.toUpperCase();
  const s = upper ? words.toUpperCase() : words;
  const oldLines = Math.max(1, Math.round(el.height / (el.fontSize * 1.13 * el.lineHeight)));
  const fits = (size: number) => estLines(s, el.fontFamily, el.width, size) * size * 1.13 * el.lineHeight <= Math.max(el.height, oldLines * size * 1.13 * el.lineHeight) * 1.02;
  let size = el.fontSize;
  while (size > 7 && !fits(size)) size -= 0.5;
  const h = estLines(s, el.fontFamily, el.width, size) * size * 1.13 * el.lineHeight;
  return { ...el, text: s, fontSize: size, y: el.y + (el.height - h) / 2, height: h, provenance: { origin: "generated", generator: "cover:saved-template" } };
}

export interface AppliedTemplate {
  cover: Pick<Cover, "background" | "elements" | "templateId" | "barcode">;
  /** The template's images, to add to the project. */
  assets: Asset[];
  warnings: string[];
}

/** Lay out a saved template on a book's cover. */
export function applyCoverTemplate(t: SavedCoverTemplate, input: Omit<CoverInput, "palette">, cg: CoverGeometry): AppliedTemplate {
  const from = frameOf(t.source);
  const to = frameOf(cg);
  const words: Record<Role, string> = {
    title: input.title,
    subtitle: input.subtitle,
    author: input.author,
    series: input.series ?? "",
    volume: input.volume ?? "",
    badge: input.badge ?? "",
  };
  const dropped = new Set<string>();
  for (const [name, role] of Object.entries(ROLES)) if (!words[role].trim()) [name, ...COMPANIONS[role]].forEach((n) => dropped.add(n));

  const elements: Element[] = [];
  for (const el of t.elements) {
    if (dropped.has(el.name ?? "") || BOOK_SPECIFIC.has(el.name ?? "")) continue;
    let next = remap({ ...structuredClone(el), id: newId("el") }, from, to);
    const role = ROLES[el.name ?? ""];
    if (role && next.type === "text") next = retext(next, words[role].trim());
    elements.push(next);
  }
  const style = { ...input, palette: { id: "saved", name: "", bg: t.background, fg: t.back.color, accent: t.back.color, muted: t.back.color } };
  elements.push(...backCover(cg, style, t.back.color, t.back.family));
  elements.push(...spineText(cg, style, t.spine.color, t.spine.family));

  const warnings: string[] = [];
  const aspect = (w: number, h: number) => w / h;
  const change = Math.abs(aspect(cg.trimW, cg.trimH) / aspect(t.source.trimW, t.source.trimH) - 1);
  if (change > 0.03 && elements.some((e) => e.type === "image"))
    warnings.push(`This template was saved for a ${fmt(t.source.trimW)}" x ${fmt(t.source.trimH)}" book; its images are stretched about ${Math.round(change * 100)}% to fit ${fmt(cg.trimW)}" x ${fmt(cg.trimH)}". Check the cover, or regenerate the art for this size.`);
  const front = elements.filter((e) => e.type === "text" && elementBounds(e).x >= cg.front.x);
  if (!front.some((e) => e.name === "Title")) warnings.push("The template has no element named Title, so the book's title was not placed on the front. Add it before exporting.");

  return {
    cover: { background: t.background, elements, templateId: `${SAVED_TEMPLATE_PREFIX}${t.id}`, barcode: t.barcode },
    assets: structuredClone(t.assets),
    warnings,
  };
}

const fmt = (pt: number) => Math.round(ptToIn(pt) * 100) / 100;

/** Validate a template file someone imported. Throws with a readable message. */
export function parseCoverTemplate(json: unknown): SavedCoverTemplate {
  const t = json as Partial<SavedCoverTemplate> | null;
  if (!t || typeof t !== "object" || t.kind !== SAVED_TEMPLATE_KIND) throw new Error("This is not a BookStudio cover template file.");
  if (t.version !== 1) throw new Error(`Unsupported cover template version ${String(t.version)}.`);
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const s = t.source;
  if (!s || !num(s.trimW) || !num(s.trimH) || !num(s.spine) || !num(s.bleed) || s.trimW <= 0 || s.trimH <= 0) throw new Error("The template's cover size is missing or invalid.");
  if (!Array.isArray(t.elements) || !t.elements.every((e) => e && typeof e === "object" && typeof e.type === "string" && num(Math.abs(e.x)) && num(Math.abs(e.y)))) throw new Error("The template's elements are invalid.");
  const types = new Set(["rect", "ellipse", "line", "text", "image", "path", "pattern"]);
  if (t.elements.some((e) => !types.has(e.type))) throw new Error("The template uses an unknown element type.");
  const assets = Array.isArray(t.assets) ? t.assets : [];
  for (const a of assets) {
    if (!a || typeof a.id !== "string" || !/^data:image\/(png|jpeg);base64,/.test(a.dataUrl ?? "") || (a.mime !== "image/png" && a.mime !== "image/jpeg")) throw new Error("The template contains an image that isn't a PNG or JPEG.");
  }
  const ids = new Set(assets.map((a) => a.id));
  if (t.elements.some((e) => e.type === "image" && !ids.has(e.assetId))) throw new Error("The template refers to an image it doesn't include.");
  const style = (v: TextStyle | undefined, family: string): TextStyle => ({ color: typeof v?.color === "string" ? v.color : "#111111", family: typeof v?.family === "string" ? v.family : family });
  return {
    kind: SAVED_TEMPLATE_KIND,
    version: 1,
    id: typeof t.id === "string" ? t.id : newId("tpl"),
    name: typeof t.name === "string" && t.name.trim() ? t.name.trim().slice(0, 80) : "Imported template",
    createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
    ...(typeof t.preview === "string" && /^data:image\/(png|jpeg);base64,/.test(t.preview) ? { preview: t.preview } : {}),
    source: { trimW: s.trimW, trimH: s.trimH, spine: s.spine, bleed: s.bleed },
    ...(typeof t.baseTemplateId === "string" ? { baseTemplateId: t.baseTemplateId } : {}),
    ...(typeof t.paletteId === "string" ? { paletteId: t.paletteId } : {}),
    background: typeof t.background === "string" ? t.background : "#ffffff",
    barcode: t.barcode === "own" ? "own" : "kdp",
    elements: t.elements,
    assets,
    back: style(t.back, "Lora"),
    spine: style(t.spine, "Montserrat"),
  };
}
