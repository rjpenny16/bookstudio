"use client";

import type { Asset, Element } from "@/lib/schema/project";
import { cssFamily, FONTS } from "./fonts";
import { expandPattern } from "./patterns";
import { baselineOffset, wrapText } from "./textLayout";

export type ImageCache = Map<string, HTMLImageElement>;

export async function loadImages(assets: Asset[], cache: ImageCache = new Map()): Promise<ImageCache> {
  await Promise.all(
    assets.map(
      (a) =>
        cache.has(a.id) ||
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            cache.set(a.id, img);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = a.dataUrl;
        }),
    ),
  );
  return cache;
}

let fontsReady: Promise<void> | null = null;
export function ensureFonts(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  fontsReady ??= Promise.all(
    FONTS.flatMap((f) => [document.fonts.load(`20px "${cssFamily(f.family, false)}"`), f.bold ? document.fonts.load(`20px "${cssFamily(f.family, true)}"`) : Promise.resolve([])]),
  ).then(() => undefined);
  return fontsReady;
}

/** Draw model elements with a 2D context already transformed to model points. */
export function drawElements(ctx: CanvasRenderingContext2D, elements: Element[], images: ImageCache) {
  for (const el of elements) {
    ctx.save();
    ctx.globalAlpha = el.opacity ?? 1;
    if (el.rotation) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((el.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }
    switch (el.type) {
      case "rect": {
        ctx.beginPath();
        if (el.cornerRadius > 0) ctx.roundRect(el.x, el.y, el.width, el.height, el.cornerRadius);
        else ctx.rect(el.x, el.y, el.width, el.height);
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fill();
        }
        if (el.stroke && el.strokeWidth > 0) {
          ctx.strokeStyle = el.stroke;
          ctx.lineWidth = el.strokeWidth;
          ctx.stroke();
        }
        break;
      }
      case "ellipse": {
        ctx.beginPath();
        ctx.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fill();
        }
        if (el.stroke && el.strokeWidth > 0) {
          ctx.strokeStyle = el.stroke;
          ctx.lineWidth = el.strokeWidth;
          ctx.stroke();
        }
        break;
      }
      case "line": {
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x + el.width, el.y + el.height);
        ctx.strokeStyle = el.stroke;
        ctx.lineWidth = el.strokeWidth;
        ctx.lineCap = el.cap === "round" ? "round" : "butt";
        if (el.dash) ctx.setLineDash(el.dash);
        ctx.stroke();
        break;
      }
      case "text": {
        ctx.font = `${el.fontSize}px "${cssFamily(el.fontFamily, el.bold)}"`;
        ctx.fillStyle = el.color;
        ctx.textBaseline = "alphabetic";
        const lines = wrapText(el.text, el.width + 0.5, (s) => ctx.measureText(s).width);
        lines.forEach((ln, i) => {
          const w = ctx.measureText(ln).width;
          const dx = el.align === "center" ? (el.width - w) / 2 : el.align === "right" ? el.width - w : 0;
          ctx.fillText(ln, el.x + dx, el.y + baselineOffset(i, el.fontSize, el.lineHeight));
        });
        break;
      }
      case "image": {
        const img = images.get(el.assetId);
        if (img) ctx.drawImage(img, el.x, el.y, el.width, el.height);
        else {
          ctx.fillStyle = "#eee";
          ctx.fillRect(el.x, el.y, el.width, el.height);
        }
        break;
      }
      case "path": {
        ctx.translate(el.x, el.y);
        const sx = el.width / (el.viewBoxW || 1);
        const sy = el.height / (el.viewBoxH || 1);
        ctx.scale(sx, sy);
        const p = new Path2D(el.d);
        if (el.fill) {
          ctx.fillStyle = el.fill;
          ctx.fill(p);
        }
        if (el.stroke) {
          ctx.strokeStyle = el.stroke;
          ctx.lineWidth = el.strokeWidth / ((sx + sy) / 2);
          ctx.lineCap = "round";
          ctx.stroke(p);
        }
        break;
      }
      case "pattern": {
        ctx.translate(el.x, el.y);
        ctx.strokeStyle = el.stroke;
        ctx.fillStyle = el.stroke;
        for (const prim of expandPattern(el)) {
          if (prim.kind === "line") {
            ctx.beginPath();
            ctx.lineWidth = prim.width;
            ctx.setLineDash(prim.dash ?? []);
            ctx.moveTo(prim.x1, prim.y1);
            ctx.lineTo(prim.x2, prim.y2);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(prim.cx, prim.cy, prim.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
    }
    ctx.restore();
  }
}

export interface RasterOptions {
  widthPt: number;
  heightPt: number;
  /** Pixels per point. */
  scale: number;
  background: string;
  elements: Element[];
  images: ImageCache;
  /** Offset of the model origin inside the raster, points. */
  originX?: number;
  originY?: number;
}

export function rasterize(o: RasterOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(o.widthPt * o.scale));
  canvas.height = Math.max(1, Math.round(o.heightPt * o.scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(o.scale, o.scale);
  ctx.translate(o.originX ?? 0, o.originY ?? 0);
  drawElements(ctx, o.elements, o.images);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), type, quality));
}
