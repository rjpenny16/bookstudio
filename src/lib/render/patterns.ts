import type { PatternElement } from "@/lib/schema/project";

export type Primitive =
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number; dash?: number[] }
  | { kind: "dot"; cx: number; cy: number; r: number };

/**
 * Expand a procedural pattern into primitives in the element's local space
 * (0..width, 0..height). Shared by the canvas editor and the PDF renderer so
 * both always draw exactly the same geometry.
 */
export function expandPattern(el: PatternElement): Primitive[] {
  const { width: w, height: h, strokeWidth: sw } = el;
  const p = el.pattern;
  const out: Primitive[] = [];
  const hline = (y: number, width = sw, dash?: number[]) => out.push({ kind: "line", x1: 0, y1: y, x2: w, y2: y, width, dash });
  const vline = (x: number, width = sw) => out.push({ kind: "line", x1: x, y1: 0, x2: x, y2: h, width });

  switch (p.kind) {
    case "lines": {
      if (p.spacing <= 1) break;
      for (let y = p.firstOffset ?? p.spacing; y <= h + 0.01; y += p.spacing) hline(y);
      break;
    }
    case "dots": {
      if (p.spacing <= 1) break;
      const ox = (w % p.spacing) / 2;
      const oy = (h % p.spacing) / 2;
      for (let y = oy; y <= h + 0.01; y += p.spacing)
        for (let x = ox; x <= w + 0.01; x += p.spacing) out.push({ kind: "dot", cx: x, cy: y, r: p.radius });
      break;
    }
    case "grid": {
      if (p.spacing <= 1) break;
      const cols = Math.floor(w / p.spacing + 0.001);
      const rows = Math.floor(h / p.spacing + 0.001);
      const ox = (w - cols * p.spacing) / 2;
      const oy = (h - rows * p.spacing) / 2;
      const major = p.majorEvery ?? 0;
      for (let i = 0; i <= cols; i++) vline(ox + i * p.spacing, major && i % major === 0 ? sw * 2 : sw);
      for (let j = 0; j <= rows; j++) {
        const width = major && j % major === 0 ? sw * 2 : sw;
        out.push({ kind: "line", x1: ox, y1: oy + j * p.spacing, x2: ox + cols * p.spacing, y2: oy + j * p.spacing, width });
      }
      // Trim vertical lines to the grid extent.
      for (const prim of out) if (prim.kind === "line" && prim.x1 === prim.x2) { prim.y1 = oy; prim.y2 = oy + rows * p.spacing; }
      break;
    }
    case "handwriting": {
      const step = p.rowHeight + p.gap;
      if (step <= 1) break;
      for (let top = 0; top + p.rowHeight <= h + 0.01; top += step) {
        hline(top);
        hline(top + p.rowHeight / 2, sw * 0.8, [3, 3]);
        hline(top + p.rowHeight, sw * 1.4);
      }
      break;
    }
    case "staff": {
      const staffH = p.lineGap * 4;
      if (p.staves < 1) break;
      const free = h - staffH * p.staves;
      const between = p.staves > 1 ? free / (p.staves - 1) : 0;
      const start = p.staves > 1 ? 0 : (h - staffH) / 2;
      for (let s = 0; s < p.staves; s++) {
        const top = start + s * (staffH + between);
        for (let l = 0; l < 5; l++) hline(top + l * p.lineGap);
        out.push({ kind: "line", x1: 0, y1: top, x2: 0, y2: top + staffH, width: sw });
        out.push({ kind: "line", x1: w, y1: top, x2: w, y2: top + staffH, width: sw });
      }
      break;
    }
  }
  return out;
}

/** Stable cache key for a pattern's rendered geometry. */
export function patternKey(el: PatternElement): string {
  return JSON.stringify([el.pattern, Math.round(el.width * 100), Math.round(el.height * 100), el.stroke, el.strokeWidth, el.opacity ?? 1]);
}
