import type { CoverGeometry } from "@/lib/kdp/geometry";
import type { Element } from "@/lib/schema/project";

/**
 * Piecewise-linear map between two covers along one axis. The breakpoints are the
 * landmarks both covers share (bleed edge, panel edges, safe-area edges), so an element
 * keeps its place relative to the nearest landmarks: art that reaches the bleed still
 * reaches it, text in the front safe area stays in the front safe area (which, on a
 * hardcover, starts after the hinge).
 */
function axisMap(from: number[], to: number[]): (v: number) => number {
  return (v) => {
    if (v <= from[0]) return to[0] + (v - from[0]);
    for (let i = 1; i < from.length; i++) {
      if (v <= from[i]) {
        const span = from[i] - from[i - 1];
        const t = span > 1e-6 ? (v - from[i - 1]) / span : 1;
        return to[i - 1] + t * (to[i] - to[i - 1]);
      }
    }
    return to[to.length - 1] + (v - from[from.length - 1]);
  };
}

const xMarks = (g: CoverGeometry) => [
  0,
  g.back.x,
  g.backSafe.x,
  g.backSafe.x + g.backSafe.width,
  g.spineBox.x,
  g.spineBox.x + g.spineBox.width,
  g.frontSafe.x,
  g.frontSafe.x + g.frontSafe.width,
  g.front.x + g.front.width,
  g.width,
];

const yMarks = (g: CoverGeometry) => [0, g.front.y, g.frontSafe.y, g.frontSafe.y + g.frontSafe.height, g.front.y + g.front.height, g.height];

/** Elements whose shape must not be stretched: they are scaled evenly around their new center. */
const KEEP_ASPECT = new Set<Element["type"]>(["text", "ellipse", "path"]);

/**
 * Move a cover design from one cover layout to another (paperback to hardcover).
 * Rectangles, lines and patterns stretch to their mapped box; images are scaled evenly
 * to cover their mapped box (cropping a little rather than distorting); text, circles
 * and vector art keep their proportions, and text sizes scale with them.
 */
export function adaptCoverElements(elements: Element[], from: CoverGeometry, to: CoverGeometry): Element[] {
  const mx = axisMap(xMarks(from), xMarks(to));
  const my = axisMap(yMarks(from), yMarks(to));
  return elements.map((el) => {
    const x0 = mx(el.x);
    const x1 = mx(el.x + el.width);
    const y0 = my(el.y);
    const y1 = my(el.y + el.height);
    const w = x1 - x0;
    const h = y1 - y0;
    const sx = el.width ? w / el.width : 1;
    const sy = el.height ? h / el.height : 1;
    if (el.type === "image" || KEEP_ASPECT.has(el.type)) {
      const s = el.type === "image" ? Math.max(sx, sy) : Math.min(sx, sy);
      const nw = el.width * s;
      const nh = el.height * s;
      const cx = x0 + w / 2;
      const cy = y0 + h / 2;
      const placed = { ...el, x: cx - nw / 2, y: cy - nh / 2, width: nw, height: nh };
      if (placed.type === "text") {
        placed.fontSize = Math.round(placed.fontSize * s * 100) / 100;
        if (placed.strokeWidth) placed.strokeWidth *= s;
      }
      return placed;
    }
    return { ...el, x: x0, y: y0, width: w, height: h };
  });
}
