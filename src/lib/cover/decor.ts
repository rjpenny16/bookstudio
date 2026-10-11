import type { Box } from "@/lib/kdp/geometry";
import { path } from "@/lib/schema/elements";
import type { PathElement } from "@/lib/schema/project";

/**
 * Vector decoration for cover designs. Everything is built from straight
 * lines and cubic curves (no arcs) so the canvas, Fabric and pdf-lib draw
 * exactly the same shapes. Coordinates are local to the box a path fills.
 */

type Pt = [number, number];

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const pt = ([x, y]: Pt) => `${n(x)} ${n(y)}`;

/** Path element filling `box`, with `d` in the box's own points. */
export function pathIn(box: Box, d: string, style: Partial<Pick<PathElement, "fill" | "stroke" | "strokeWidth" | "opacity" | "name">>): PathElement {
  return path({ x: box.x, y: box.y, width: box.width, height: box.height, viewBoxW: box.width, viewBoxH: box.height, d, fill: null, stroke: null, strokeWidth: 0, ...style });
}

export function polygon(points: Pt[]): string {
  if (points.length < 3) return "";
  return `M${points.map(pt).join(" L")} Z`;
}

const K = 0.5523;

export function circle(cx: number, cy: number, r: number): string {
  const k = r * K;
  return `M${pt([cx - r, cy])} C${pt([cx - r, cy - k])} ${pt([cx - k, cy - r])} ${pt([cx, cy - r])} C${pt([cx + k, cy - r])} ${pt([cx + r, cy - k])} ${pt([cx + r, cy])} C${pt([cx + r, cy + k])} ${pt([cx + k, cy + r])} ${pt([cx, cy + r])} C${pt([cx - k, cy + r])} ${pt([cx - r, cy + k])} ${pt([cx - r, cy])} Z`;
}

/** Upper half of a circle, as an open stroke. */
export function halfCircle(cx: number, cy: number, r: number): string {
  const k = r * K;
  return `M${pt([cx - r, cy])} C${pt([cx - r, cy - k])} ${pt([cx - k, cy - r])} ${pt([cx, cy - r])} C${pt([cx + k, cy - r])} ${pt([cx + r, cy - k])} ${pt([cx + r, cy])}`;
}

/** A pointed petal or leaf from (cx, cy) out to length `len` at angle `a`. */
export function petal(cx: number, cy: number, len: number, width: number, a: number): string {
  const dx = Math.cos(a) * len;
  const dy = Math.sin(a) * len;
  const ux = -Math.sin(a) * width;
  const uy = Math.cos(a) * width;
  const c: Pt = [cx, cy];
  const tip: Pt = [cx + dx, cy + dy];
  return `M${pt(c)} C${pt([cx + dx * 0.35 + ux, cy + dy * 0.35 + uy])} ${pt([cx + dx * 0.9 + ux * 0.6, cy + dy * 0.9 + uy * 0.6])} ${pt(tip)} C${pt([cx + dx * 0.9 - ux * 0.6, cy + dy * 0.9 - uy * 0.6])} ${pt([cx + dx * 0.35 - ux, cy + dy * 0.35 - uy])} ${pt(c)} Z`;
}

/** Star or starburst with `points` tips between radii `inner` and `outer`. */
export function star(cx: number, cy: number, outer: number, inner: number, points: number, rotation = -Math.PI / 2): string {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rotation + (i * Math.PI) / points;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return polygon(out);
}

/** Sutherland-Hodgman clip of a polygon to an axis-aligned box. */
export function clipPolygon(points: Pt[], b: Box): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, c: Pt) => Pt][] = [
    [(p) => p[0] >= b.x, (a, c) => lerpAt(a, c, (b.x - a[0]) / (c[0] - a[0]))],
    [(p) => p[0] <= b.x + b.width, (a, c) => lerpAt(a, c, (b.x + b.width - a[0]) / (c[0] - a[0]))],
    [(p) => p[1] >= b.y, (a, c) => lerpAt(a, c, (b.y - a[1]) / (c[1] - a[1]))],
    [(p) => p[1] <= b.y + b.height, (a, c) => lerpAt(a, c, (b.y + b.height - a[1]) / (c[1] - a[1]))],
  ];
  let poly = points;
  for (const [inside, cut] of edges) {
    if (!poly.length) break;
    const next: Pt[] = [];
    poly.forEach((cur, i) => {
      const prev = poly[(i + poly.length - 1) % poly.length];
      if (inside(cur)) {
        if (!inside(prev)) next.push(cut(prev, cur));
        next.push(cur);
      } else if (inside(prev)) next.push(cut(prev, cur));
    });
    poly = next;
  }
  return poly;
}

const lerpAt = (a: Pt, c: Pt, t: number): Pt => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];

/** Sun rays from (cx, cy) clipped to `clip`: every other wedge of `count`. */
export function rays(cx: number, cy: number, count: number, clip: Box): string {
  const R = (clip.width + clip.height) * 2;
  const step = (Math.PI * 2) / count;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 2) {
    const a = i * step;
    const wedge: Pt[] = [
      [cx, cy],
      [cx + Math.cos(a) * R, cy + Math.sin(a) * R],
      [cx + Math.cos(a + step) * R, cy + Math.sin(a + step) * R],
    ];
    parts.push(polygon(clipPolygon(wedge, clip)));
  }
  return parts.filter(Boolean).join(" ");
}

/** Diagonal lattice (both directions) inside a w x h box, lines `spacing` apart. */
export function lattice(w: number, h: number, spacing: number): string {
  const step = spacing * Math.SQRT2;
  const parts: string[] = [];
  // y = x + c
  for (let c = -w + step / 2; c < h; c += step) {
    const x1 = Math.max(0, -c);
    const x2 = Math.min(w, h - c);
    if (x2 > x1) parts.push(`M${pt([x1, x1 + c])} L${pt([x2, x2 + c])}`);
  }
  // y = -x + c
  for (let c = step / 2; c < w + h; c += step) {
    const x1 = Math.max(0, c - h);
    const x2 = Math.min(w, c);
    if (x2 > x1) parts.push(`M${pt([x1, c - x1])} L${pt([x2, c - x2])}`);
  }
  return parts.join(" ");
}

/** Rectangle with concave (scooped) corners, like an old shop label. */
export function notchedRect(w: number, h: number, r: number): string {
  const k = r * 0.55;
  return [
    `M${pt([r, 0])} L${pt([w - r, 0])}`,
    `C${pt([w - r, k])} ${pt([w - k, r])} ${pt([w, r])}`,
    `L${pt([w, h - r])}`,
    `C${pt([w - k, h - r])} ${pt([w - r, h - k])} ${pt([w - r, h])}`,
    `L${pt([r, h])}`,
    `C${pt([r, h - k])} ${pt([k, h - r])} ${pt([0, h - r])}`,
    `L${pt([0, r])}`,
    `C${pt([k, r])} ${pt([r, k])} ${pt([r, 0])} Z`,
  ].join(" ");
}

/** Bookmark ribbon: a w x h strip with a V notch cut into the bottom. */
export function ribbon(w: number, h: number, notch: number): string {
  return polygon([
    [0, 0],
    [w, 0],
    [w, h],
    [w / 2, h - notch],
    [0, h],
  ]);
}

/** Small diamond ornament flanked by two rules, centered in a w x h box. */
export function ornament(w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const d = h / 2;
  return `${polygon([
    [cx, cy - d],
    [cx + d, cy],
    [cx, cy + d],
    [cx - d, cy],
  ])} ${polygon([
    [0, cy - 0.6],
    [cx - d - 4, cy - 0.6],
    [cx - d - 4, cy + 0.6],
    [0, cy + 0.6],
  ])} ${polygon([
    [cx + d + 4, cy - 0.6],
    [w, cy - 0.6],
    [w, cy + 0.6],
    [cx + d + 4, cy + 0.6],
  ])}`;
}
