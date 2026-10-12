import fontkit from "@pdf-lib/fontkit";
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  TextRenderingMode,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setLineJoin,
  setLineWidth,
  setStrokingColor,
  setTextRenderingMode,
  type PDFEmbeddedPage,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { coverGeometry, interiorGeometry, trimOffset } from "@/lib/kdp/geometry";
import type { Asset, Element, PatternElement, Project } from "@/lib/schema/project";
import { fontFile, type FontBytesLoader } from "./fonts";
import { expandPattern, patternKey } from "./patterns";
import { baselineOffset, wrapText } from "./textLayout";
import { pageNumberElement } from "./pageNumbers";

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return rgb(0, 0, 0);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

interface Ctx {
  doc: PDFDocument;
  loadFont: FontBytesLoader;
  fonts: Map<string, PDFFont>;
  images: Map<string, PDFImage>;
  patterns: Map<string, PDFEmbeddedPage>;
  assets: Map<string, Asset>;
}

interface Origin {
  x: number;
  y: number;
  pageH: number;
}

async function getFont(ctx: Ctx, family: string, bold: boolean): Promise<PDFFont> {
  const file = fontFile(family, bold);
  let font = ctx.fonts.get(file);
  if (!font) {
    // Full embedding (no subsetting) is the most robust choice for print workflows.
    font = await ctx.doc.embedFont(await ctx.loadFont(file), { subset: false });
    ctx.fonts.set(file, font);
  }
  return font;
}

async function getImage(ctx: Ctx, assetId: string): Promise<PDFImage | null> {
  const cached = ctx.images.get(assetId);
  if (cached) return cached;
  const asset = ctx.assets.get(assetId);
  if (!asset) return null;
  const bytes = dataUrlToBytes(asset.dataUrl);
  const img = asset.mime === "image/png" ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes);
  ctx.images.set(assetId, img);
  return img;
}

async function getPattern(ctx: Ctx, el: PatternElement): Promise<PDFEmbeddedPage> {
  const key = patternKey(el);
  const cached = ctx.patterns.get(key);
  if (cached) return cached;
  // Render once into a scratch document and reuse it as a form XObject on every page.
  const scratch = await PDFDocument.create();
  const p = scratch.addPage([Math.max(1, el.width), Math.max(1, el.height)]);
  const color = hexToRgb(el.stroke);
  // Opacity is baked into the form: page-level opacity on drawPage does not reach strokes.
  const opacity = el.opacity ?? 1;
  for (const prim of expandPattern(el)) {
    if (prim.kind === "line") {
      p.drawLine({
        start: { x: prim.x1, y: el.height - prim.y1 },
        end: { x: prim.x2, y: el.height - prim.y2 },
        thickness: prim.width,
        color,
        dashArray: prim.dash,
        opacity,
      });
    } else {
      p.drawCircle({ x: prim.cx, y: el.height - prim.cy, size: prim.r, color, opacity });
    }
  }
  const [embedded] = await ctx.doc.embedPdf(await scratch.save());
  ctx.patterns.set(key, embedded);
  return embedded;
}

function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${rr} 0 L ${w - rr} 0 Q ${w} 0 ${w} ${rr} L ${w} ${h - rr} Q ${w} ${h} ${w - rr} ${h} L ${rr} ${h} Q 0 ${h} 0 ${h - rr} L 0 ${rr} Q 0 0 ${rr} 0 Z`;
}

async function drawElement(ctx: Ctx, page: PDFPage, el: Element, o: Origin): Promise<void> {
  const X = (x: number) => o.x + x;
  const Y = (y: number) => o.pageH - (o.y + y);
  const opacity = el.opacity ?? 1;

  const rotated = el.rotation % 360 !== 0;
  if (rotated) {
    const cx = X(el.x + el.width / 2);
    const cy = Y(el.y + el.height / 2);
    const rad = (-el.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy),
    );
  }

  switch (el.type) {
    case "rect": {
      const fill = el.fill ? hexToRgb(el.fill) : undefined;
      const border = el.stroke && el.strokeWidth > 0 ? hexToRgb(el.stroke) : undefined;
      if (el.cornerRadius > 0) {
        page.drawSvgPath(roundedRectPath(el.width, el.height, el.cornerRadius), {
          x: X(el.x),
          y: Y(el.y),
          color: fill,
          borderColor: border,
          borderWidth: border ? el.strokeWidth : 0,
          opacity,
          borderOpacity: opacity,
        });
      } else {
        page.drawRectangle({
          x: X(el.x),
          y: Y(el.y + el.height),
          width: el.width,
          height: el.height,
          color: fill,
          borderColor: border,
          borderWidth: border ? el.strokeWidth : 0,
          opacity,
          borderOpacity: opacity,
        });
      }
      break;
    }
    case "ellipse": {
      const border = el.stroke && el.strokeWidth > 0 ? hexToRgb(el.stroke) : undefined;
      page.drawEllipse({
        x: X(el.x + el.width / 2),
        y: Y(el.y + el.height / 2),
        xScale: el.width / 2,
        yScale: el.height / 2,
        color: el.fill ? hexToRgb(el.fill) : undefined,
        borderColor: border,
        borderWidth: border ? el.strokeWidth : 0,
        opacity,
        borderOpacity: opacity,
      });
      break;
    }
    case "line": {
      page.drawLine({
        start: { x: X(el.x), y: Y(el.y) },
        end: { x: X(el.x + el.width), y: Y(el.y + el.height) },
        thickness: el.strokeWidth,
        color: hexToRgb(el.stroke),
        dashArray: el.dash,
        lineCap: el.cap === "round" ? LineCapStyle.Round : LineCapStyle.Butt,
        opacity,
      });
      break;
    }
    case "text": {
      const font = await getFont(ctx, el.fontFamily, el.bold);
      // Character spacing (Tc) follows every character, as on the canvas and in Fabric.
      const spacing = (el.letterSpacing ?? 0) * el.fontSize;
      const measure = (s: string) => font.widthOfTextAtSize(s, el.fontSize) + [...s].length * spacing;
      const lines = wrapText(el.text, el.width + 0.5, measure);
      const color = hexToRgb(el.color);
      const outline = el.strokeColor && el.strokeWidth ? el.strokeWidth : 0;
      const draw = () =>
        lines.forEach((ln, i) => {
          if (!ln) return;
          const w = measure(ln);
          const dx = el.align === "center" ? (el.width - w) / 2 : el.align === "right" ? el.width - w : 0;
          page.drawText(ln, {
            x: X(el.x + dx),
            y: Y(el.y + baselineOffset(i, el.fontSize, el.lineHeight)),
            size: el.fontSize,
            font,
            color,
            opacity,
          });
        });
      if (spacing) page.pushOperators(pushGraphicsState(), setCharacterSpacing(spacing));
      if (outline) {
        // The outline is stroked first and the letters filled over it, so it sits outside the glyph edge.
        page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Outline), setStrokingColor(hexToRgb(el.strokeColor!)), setLineWidth(outline * 2), setLineJoin(LineJoinStyle.Round));
        draw();
        page.pushOperators(popGraphicsState());
      }
      draw();
      if (spacing) page.pushOperators(popGraphicsState());
      break;
    }
    case "image": {
      const img = await getImage(ctx, el.assetId);
      if (img) page.drawImage(img, { x: X(el.x), y: Y(el.y + el.height), width: el.width, height: el.height, opacity });
      break;
    }
    case "path": {
      const sx = el.width / (el.viewBoxW || 1);
      const sy = el.height / (el.viewBoxH || 1);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, X(el.x), Y(el.y)));
      page.drawSvgPath(el.d, {
        x: 0,
        y: 0,
        color: el.fill ? hexToRgb(el.fill) : undefined,
        borderColor: el.stroke ? hexToRgb(el.stroke) : undefined,
        borderWidth: el.stroke ? el.strokeWidth / ((sx + sy) / 2) : 0,
        borderLineCap: LineCapStyle.Round,
        opacity,
        borderOpacity: opacity,
      });
      page.pushOperators(popGraphicsState());
      break;
    }
    case "pattern": {
      const embedded = await getPattern(ctx, el);
      page.drawPage(embedded, { x: X(el.x), y: Y(el.y + el.height), width: el.width, height: el.height });
      break;
    }
  }

  if (rotated) page.pushOperators(popGraphicsState());
}

async function newContext(project: Project, loadFont: FontBytesLoader, title: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setAuthor(project.metadata.author || "");
  doc.setProducer("BookStudio");
  doc.setCreator("BookStudio (open-source KDP publishing studio)");
  doc.setCreationDate(new Date(project.updatedAt));
  doc.setModificationDate(new Date(project.updatedAt));
  return {
    doc,
    loadFont,
    fonts: new Map(),
    images: new Map(),
    patterns: new Map(),
    assets: new Map(project.assets.map((a) => [a.id, a])),
  };
}

export interface RenderOptions {
  loadFont: FontBytesLoader;
  onProgress?: (done: number, total: number) => void;
  /** Render only these page indices (preview). */
  pageIndices?: number[];
}

export async function renderInteriorPdf(project: Project, opts: RenderOptions): Promise<Uint8Array> {
  const pages = project.interior.pages;
  const g = interiorGeometry(project.spec, pages.length);
  const ctx = await newContext(project, opts.loadFont, `${project.metadata.title || project.name} (interior)`);
  const pn = project.interior.pageNumbers;
  const indices = opts.pageIndices ?? pages.map((_, i) => i);
  let done = 0;
  for (const i of indices) {
    const pageModel = pages[i];
    const page = ctx.doc.addPage([g.pageW, g.pageH]);
    const off = trimOffset(g, i);
    const origin = { x: off.x, y: off.y, pageH: g.pageH };
    for (const el of pageModel.elements) await drawElement(ctx, page, el, origin);
    if (pn.enabled && i + 1 >= pn.startAt && !pageModel.hideNumber) {
      const numberEl = pageNumberElement(project, i);
      await drawElement(ctx, page, numberEl, origin);
    }
    done++;
    if (opts.onProgress && done % 10 === 0) opts.onProgress(done, indices.length);
  }
  opts.onProgress?.(indices.length, indices.length);
  return ctx.doc.save({ useObjectStreams: false });
}

export async function renderCoverPdf(project: Project, opts: RenderOptions): Promise<Uint8Array> {
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const ctx = await newContext(project, opts.loadFont, `${project.metadata.title || project.name} (cover)`);
  const page = ctx.doc.addPage([cg.width, cg.height]);
  page.drawRectangle({ x: 0, y: 0, width: cg.width, height: cg.height, color: hexToRgb(project.cover.background) });
  const origin = { x: 0, y: 0, pageH: cg.height };
  for (const el of project.cover.elements) await drawElement(ctx, page, el, origin);
  return ctx.doc.save({ useObjectStreams: false });
}

