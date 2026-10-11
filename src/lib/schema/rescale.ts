import { produce } from "immer";
import { coverGeometry, findTrim } from "@/lib/kdp/geometry";
import type { Element, PrintSpec, Project } from "./project";

function scaleElement(el: Element, sx: number, sy: number): Element {
  const s = Math.min(sx, sy);
  const out = { ...el, x: el.x * sx, y: el.y * sy, width: el.width * sx, height: el.height * sy };
  if (out.type === "text") out.fontSize = Math.round(out.fontSize * s * 10) / 10;
  if (out.type === "image" || out.type === "ellipse") {
    // Keep aspect ratio for pictures and circles: scale uniformly around the scaled center.
    const cx = out.x + out.width / 2;
    const cy = out.y + out.height / 2;
    out.width = el.width * s;
    out.height = el.height * s;
    out.x = cx - out.width / 2;
    out.y = cy - out.height / 2;
  }
  return out;
}

/**
 * Change the print spec. With `scaleContent`, interior pages and the cover panels
 * are scaled proportionally to the new trim so layouts keep their margins.
 */
export function changeSpec(project: Project, patch: Partial<PrintSpec>, scaleContent: boolean): Project {
  const trim = patch.trimId ? findTrim(patch.trimId) : undefined;
  const next: PrintSpec = { ...project.spec, ...patch, ...(trim ? { widthIn: trim.widthIn, heightIn: trim.heightIn } : {}) };
  const sx = next.widthIn / project.spec.widthIn;
  const sy = next.heightIn / project.spec.heightIn;
  return produce(project, (d) => {
    d.spec = next;
    if (!scaleContent || (sx === 1 && sy === 1)) return;
    d.interior.pages.forEach((p) => {
      p.elements = p.elements.map((e) => scaleElement(e as Element, sx, sy));
    });
    // Cover: scale each element relative to the panel it sits on.
    const n = project.interior.pages.length;
    const before = coverGeometry(project.spec, n);
    const after = coverGeometry(next, n);
    d.cover.elements = project.cover.elements.map((el) => {
      const cx = el.x + el.width / 2;
      const panel = cx < before.spineBox.x ? "back" : cx > before.spineBox.x + before.spineBox.width ? "front" : "spine";
      const from = panel === "back" ? before.back : panel === "front" ? before.front : before.spineBox;
      const to = panel === "back" ? after.back : panel === "front" ? after.front : after.spineBox;
      const scaled = scaleElement({ ...el, x: el.x - from.x, y: el.y - from.y }, panel === "spine" ? 1 : sx, sy);
      return { ...scaled, x: scaled.x + to.x, y: scaled.y + to.y };
    });
  });
}
