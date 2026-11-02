import { adaptCoverElements } from "@/lib/cover/adapt";
import { boardExtrasFromKdpSize, coverGeometry, hardcoverAvailability } from "@/lib/kdp/geometry";
import { RULES_VERSION_HARDCOVER } from "@/lib/kdp/rules-hardcover";
import { editionOf } from "./formats";
import type { PrintSpec, Project } from "./project";

/**
 * The hardcover shares the paperback's trim, paper, ink and interior, so its spec is the
 * paperback spec with the binding changed. When the author has adopted the cover size
 * from KDP's cover calculator, the boards are sized to match it.
 */
export function hardcoverSpec(p: Pick<Project, "spec" | "formats">): PrintSpec {
  const base: PrintSpec = { ...p.spec, binding: "hardcover", rulesVersion: RULES_VERSION_HARDCOVER };
  delete base.coverAdjust;
  const check = editionOf(p, "hardcover").coverCheck;
  return check?.adopt ? { ...base, coverAdjust: boardExtrasFromKdpSize(base, check) } : base;
}

/**
 * The book as its hardcover: hardcover spec, and the paperback cover laid out on the
 * hardcover's boards. The hardcover cover is always derived, so editing the paperback
 * cover updates both.
 */
export function hardcoverProject(p: Project): Project {
  const n = p.interior.pages.length;
  const spec = hardcoverSpec(p);
  const elements = adaptCoverElements(p.cover.elements, coverGeometry(p.spec, n), coverGeometry(spec, n));
  return { ...p, spec, cover: { ...p.cover, elements } };
}

export const hardcoverReady = (p: Project) => hardcoverAvailability(p.spec, p.interior.pages.length);
