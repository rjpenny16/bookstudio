import { produce } from "immer";
import { boxContains, boxesIntersect, coverGeometry, interiorGeometry, safeArea, type Box } from "@/lib/kdp/geometry";
import { pageRange } from "@/lib/kdp/rules";
import { cleanKeywords } from "@/lib/metadata/validate";
import { elementBounds } from "@/lib/schema/elements";
import type { Element, Page, Project } from "@/lib/schema/project";
import { newId } from "@/lib/util/ids";
import { reflowCoverElements } from "@/lib/cover/reflow";
import { aiUsage } from "./aiUsage";
import type { FixId } from "./index";

/** Translate (and if needed shrink) an element so its bounds fit inside `box`. */
export function fitInto<T extends Element>(el: T, box: Box): T {
  const out = { ...el };
  let b = elementBounds(out);
  if (b.width > box.width || b.height > box.height) {
    const s = Math.min(box.width / b.width, box.height / b.height) * 0.98;
    out.width *= s;
    out.height *= s;
    if (out.type === "text") out.fontSize = Math.max(4, out.fontSize * s);
    b = elementBounds(out);
  }
  let dx = 0;
  let dy = 0;
  if (b.x < box.x) dx = box.x - b.x;
  else if (b.x + b.width > box.x + box.width) dx = box.x + box.width - (b.x + b.width);
  if (b.y < box.y) dy = box.y - b.y;
  else if (b.y + b.height > box.y + box.height) dy = box.y + box.height - (b.y + b.height);
  out.x += dx;
  out.y += dy;
  return out;
}

function blankPage(): Page {
  return { id: newId("pg"), elements: [], hideNumber: true, generator: { kind: "blank" } };
}

export function addPagesKeepingCover(project: Project, mutate: (pages: Page[]) => void): Project {
  const before = project.interior.pages.length;
  return produce(project, (d) => {
    mutate(d.interior.pages);
    const after = d.interior.pages.length;
    if (after !== before) d.cover.elements = reflowCoverElements(d.cover.elements as Element[], d.spec, before, after);
  });
}

export function applyFix(project: Project, fix: FixId): Project {
  switch (fix) {
    case "pad-even":
      return addPagesKeepingCover(project, (pages) => {
        if (pages.length % 2) pages.push(blankPage());
      });
    case "pad-min": {
      const min = pageRange(project.spec.ink, project.spec.paper).min;
      return addPagesKeepingCover(project, (pages) => {
        while (pages.length < min) pages.push(blankPage());
      });
    }
    case "move-into-safe":
      return produce(project, (d) => {
        const g = interiorGeometry(d.spec, d.interior.pages.length);
        d.interior.pages.forEach((p, i) => {
          const safe = safeArea(g, i);
          p.elements = p.elements.map((el) => {
            const b = elementBounds(el as Element);
            if (boxContains(safe, b, 0.5)) return el;
            // Backgrounds may legitimately bleed; only pull in text, or anything when bleed is off.
            if (el.type !== "text" && d.spec.bleed) return el;
            return fitInto(el as Element, safe);
          });
        });
        const cg = coverGeometry(d.spec, d.interior.pages.length);
        d.cover.elements = d.cover.elements.map((el) => {
          if (el.type !== "text") return el;
          const b = elementBounds(el as Element);
          const panels = [cg.backSafe, cg.frontSafe, cg.spineSafe];
          if (panels.some((p) => boxContains(p, b, 0.5))) return el;
          const cx = b.x + b.width / 2;
          const target = cx < cg.spineBox.x ? cg.backSafe : cx > cg.spineBox.x + cg.spineBox.width ? cg.frontSafe : cg.spineSafe;
          return fitInto(el as Element, target);
        });
      });
    case "remove-spine-text":
      return produce(project, (d) => {
        const cg = coverGeometry(d.spec, d.interior.pages.length);
        d.cover.elements = d.cover.elements.filter((el) => {
          if (el.type !== "text") return true;
          const b = elementBounds(el as Element);
          return !(boxesIntersect(b, cg.spineBox) && !boxContains(cg.backSafe, b) && !boxContains(cg.frontSafe, b));
        });
      });
    case "clear-barcode":
      return produce(project, (d) => {
        const cg = coverGeometry(d.spec, d.interior.pages.length);
        d.cover.elements = d.cover.elements.map((el) => {
          if (el.type !== "text" && el.type !== "image") return el;
          const b = elementBounds(el as Element);
          if (!boxesIntersect(b, cg.barcode)) return el;
          const avail: Box = { x: cg.backSafe.x, y: cg.backSafe.y, width: cg.backSafe.width, height: cg.barcode.y - 8 - cg.backSafe.y };
          return fitInto(el as Element, avail);
        });
      });
    case "clean-keywords":
      return produce(project, (d) => {
        d.metadata.keywords = cleanKeywords(d.metadata.keywords);
      });
    case "suggest-ai-disclosure":
      return produce(project, (d) => {
        const u = aiUsage(project);
        if (u.text && d.metadata.aiDisclosure.text === "none") d.metadata.aiDisclosure.text = "some";
        if (u.images && d.metadata.aiDisclosure.images === "none") d.metadata.aiDisclosure.images = "some";
        // Confirmation stays a human decision.
      });
    case "fix-paper-ink":
      return produce(project, (d) => {
        d.spec.paper = "white";
      });
  }
}
