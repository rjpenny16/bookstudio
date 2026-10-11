import { coverGeometry } from "@/lib/kdp/geometry";
import type { Element, PrintSpec } from "@/lib/schema/project";

/**
 * Keep the cover design anchored when the spine width changes (page count or
 * paper changed): front-cover elements move with the front panel, spine
 * elements stay centered on the spine, and full-wrap elements stretch.
 */
export function reflowCoverElements(elements: Element[], spec: PrintSpec, oldPages: number, newPages: number, oldSpec: PrintSpec = spec): Element[] {
  const before = coverGeometry(oldSpec, oldPages);
  const after = coverGeometry(spec, newPages);
  const delta = after.spine - before.spine;
  if (Math.abs(delta) < 0.001 && before.width === after.width) return elements;
  const spineStart = before.spineBox.x;
  const spineEnd = before.spineBox.x + before.spineBox.width;
  return elements.map((el) => {
    const left = Math.min(el.x, el.x + (el.type === "line" ? el.width : 0));
    const right = Math.max(el.x + el.width, el.x);
    const cx = el.x + el.width / 2;
    // Spans across the spine: stretch.
    if (left <= spineStart + 0.5 && right >= spineEnd - 0.5 && el.rotation === 0) return { ...el, width: el.width + delta };
    if (cx >= spineEnd) return { ...el, x: el.x + delta };
    if (cx > spineStart) return { ...el, x: el.x + delta / 2 };
    return el;
  });
}
