import type { Box } from "@/lib/kdp/geometry";
import { DEFAULT_FONT } from "@/lib/render/fonts";
import { newId } from "@/lib/util/ids";
import type {
  ArtifactProvenance,
  Element,
  EllipseElement,
  ImageElement,
  LineElement,
  PathElement,
  PatternElement,
  PatternSpec,
  RectElement,
  TextElement,
} from "./project";

type Init<T> = Partial<Omit<T, "type">> & Pick<BaseInit, "x" | "y">;
interface BaseInit {
  x: number;
  y: number;
}

const base = (p: { x: number; y: number; width?: number; height?: number; rotation?: number }, w = 100, h = 100) => ({
  id: newId("el"),
  x: p.x,
  y: p.y,
  width: p.width ?? w,
  height: p.height ?? h,
  rotation: p.rotation ?? 0,
});

export function rect(p: Init<RectElement>): RectElement {
  return { fill: "#000000", stroke: null, strokeWidth: 0, cornerRadius: 0, ...p, ...base(p), type: "rect", id: p.id ?? newId("el") };
}

export function ellipse(p: Init<EllipseElement>): EllipseElement {
  return { fill: "#000000", stroke: null, strokeWidth: 0, ...p, ...base(p), type: "ellipse", id: p.id ?? newId("el") };
}

export function line(p: Init<LineElement>): LineElement {
  return { stroke: "#000000", strokeWidth: 0.75, ...p, ...base(p, 100, 0), type: "line", id: p.id ?? newId("el") };
}

export function text(p: Init<TextElement>): TextElement {
  const fontSize = p.fontSize ?? 12;
  return {
    text: "Text",
    fontFamily: DEFAULT_FONT,
    bold: false,
    color: "#000000",
    align: "left",
    lineHeight: 1.16,
    ...p,
    fontSize,
    ...base(p, 200, fontSize * 1.13),
    type: "text",
    id: p.id ?? newId("el"),
  };
}

export function image(p: Init<ImageElement> & { assetId: string }): ImageElement {
  return { ...p, ...base(p), type: "image", id: p.id ?? newId("el") };
}

export function path(p: Init<PathElement> & { d: string; viewBoxW: number; viewBoxH: number }): PathElement {
  return { fill: null, stroke: "#000000", strokeWidth: 1, ...p, ...base(p, p.viewBoxW, p.viewBoxH), type: "path", id: p.id ?? newId("el") };
}

export function pattern(p: Init<PatternElement> & { pattern: PatternSpec }): PatternElement {
  return { stroke: "#9a9a9a", strokeWidth: 0.5, ...p, ...base(p), type: "pattern", id: p.id ?? newId("el") };
}

export function withProvenance<T extends Element>(el: T, provenance: ArtifactProvenance): T {
  return { ...el, provenance };
}

/** Axis-aligned bounds, accounting for rotation and stroke. */
export function elementBounds(el: Element): Box {
  let x = el.x;
  let y = el.y;
  let w = el.width;
  let h = el.height;
  if (el.type === "line") {
    x = Math.min(el.x, el.x + el.width);
    y = Math.min(el.y, el.y + el.height);
    w = Math.abs(el.width);
    h = Math.abs(el.height);
  }
  const pad = "strokeWidth" in el && (el.type !== "rect" || el.stroke) ? (el.strokeWidth ?? 0) / 2 : 0;
  x -= pad;
  y -= pad;
  w += pad * 2;
  h += pad * 2;
  if (!el.rotation) return { x, y, width: w, height: h };
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = (el.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: cx - bw / 2, y: cy - bh / 2, width: bw, height: bh };
}

export function cloneElement<T extends Element>(el: T, dx = 0, dy = 0): T {
  return { ...structuredClone(el), id: newId("el"), x: el.x + dx, y: el.y + dy };
}

export const ELEMENT_LABELS: Record<Element["type"], string> = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  text: "Text",
  image: "Image",
  path: "Vector",
  pattern: "Pattern",
};

export function elementLabel(el: Element): string {
  if (el.type === "text") return el.text.split("\n")[0].slice(0, 32) || el.name || "Text";
  if (el.name) return el.name;
  if (el.type === "pattern") return `Pattern (${el.pattern.kind})`;
  return ELEMENT_LABELS[el.type];
}
