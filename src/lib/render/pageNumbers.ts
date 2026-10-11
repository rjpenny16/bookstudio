import { interiorGeometry } from "@/lib/kdp/geometry";
import type { Element, Project } from "@/lib/schema/project";

/** Page numbers are rendered, not stored: centered at the bottom of the live area. */
export function pageNumberElement(project: Project, pageIndex: number): Extract<Element, { type: "text" }> {
  const g = interiorGeometry(project.spec, project.interior.pages.length);
  const pn = project.interior.pageNumbers;
  const h = pn.fontSize * 1.13;
  return {
    id: `pn_${pageIndex}`,
    type: "text",
    text: String(pageIndex + 1),
    x: g.trimW / 2 - 40,
    y: g.trimH - g.outside - h,
    width: 80,
    height: h,
    rotation: 0,
    fontFamily: pn.fontFamily,
    bold: false,
    fontSize: pn.fontSize,
    color: "#333333",
    align: "center",
    lineHeight: 1,
  };
}
