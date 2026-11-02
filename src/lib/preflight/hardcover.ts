import { boxContains, boxesIntersect, coverGeometry, coverSizeDiffIn, royaltyUsd } from "@/lib/kdp/geometry";
import { COVER_SIZE_TOLERANCE_IN } from "@/lib/kdp/rules-hardcover";
import { elementBounds, elementLabel } from "@/lib/schema/elements";
import { editionOf } from "@/lib/schema/formats";
import { hardcoverProject, hardcoverReady } from "@/lib/schema/hardcover";
import { isLowContent, type Project } from "@/lib/schema/project";
import { round } from "@/lib/util/ids";
import type { Check, Issue } from "./index";

const digits = (s: string) => s.replace(/[-\s]/g, "");

/**
 * The hardcover edition, when it is turned on: can this book be a hardcover, does the
 * cover fit the boards (text off the hinge), does it have its own ISBN and a workable
 * price, and does the cover size match KDP's cover calculator.
 */
export function hardcoverCheck(project: Project): Check | null {
  const e = editionOf(project, "hardcover");
  if (!e.enabled) return null;
  const fails: Issue[] = [];
  const warns: Issue[] = [];
  let fix: Check["fix"];
  const n = project.interior.pages.length;

  const ready = hardcoverReady(project);
  for (const r of ready.reasons) fails.push({ area: "spec", message: r });

  const hc = hardcoverProject(project);
  const cg = coverGeometry(hc.spec, n);
  if (ready.ok) {
    const panels = [cg.backSafe, cg.frontSafe, cg.spineSafe];
    for (const el of hc.cover.elements) {
      if (el.type !== "text") continue;
      const b = elementBounds(el);
      const label = elementLabel(el);
      if ((cg.hingeFront && boxesIntersect(b, cg.hingeFront)) || (cg.hingeBack && boxesIntersect(b, cg.hingeBack))) fails.push({ area: "cover", elementId: el.id, message: `Hardcover: "${label}" runs onto the hinge, where the board bends.` });
      else if (!panels.some((p) => boxContains(p, b, 0.5))) fails.push({ area: "cover", elementId: el.id, message: `Hardcover: "${label}" is outside the safe area of the boards.` });
    }
  }

  const isbn = e.isbn ?? { kind: "none", value: "" };
  const paper = project.metadata.isbn;
  if (isbn.kind === "own" && paper.kind === "own" && digits(isbn.value) && digits(isbn.value) === digits(paper.value)) fails.push({ area: "listing", message: "The hardcover uses the paperback's ISBN. Each format needs its own." });
  if (isbn.kind === "own" && !/^(97[89])?\d{9}[\dX]$/.test(digits(isbn.value))) fails.push({ area: "listing", message: "The hardcover ISBN does not look like a valid ISBN-10/13." });
  if (isbn.kind === "kdp-free" && isLowContent(project.bookType)) fails.push({ area: "listing", message: "Low-content books are not eligible for a free KDP ISBN. Use no ISBN or your own." });
  if (isbn.kind === "none" && !isLowContent(project.bookType)) warns.push({ area: "listing", message: "Choose an ISBN for the hardcover: a free KDP ISBN or your own." });

  if (e.listPriceUsd == null) warns.push({ area: "listing", message: "Set a hardcover list price." });
  else if (ready.ok) {
    const r = royaltyUsd(hc.spec, n, e.listPriceUsd);
    if (r.royalty < 0) fails.push({ area: "listing", message: `Hardcover price $${e.listPriceUsd.toFixed(2)} is below printing cost; minimum is $${r.minListPrice.toFixed(2)}.` });
  }

  if (ready.ok) {
    const kdp = e.coverCheck;
    if (!kdp) warns.push({ area: "spec", message: "Enter the full cover size from KDP's hardcover cover calculator so BookStudio can check its cover against it." });
    else if (kdp.pages !== n) warns.push({ area: "spec", message: `The KDP cover size you entered was for ${kdp.pages} pages; the book now has ${n}. Enter KDP's size for ${n} pages.` });
    else {
      const diff = coverSizeDiffIn(hc.spec, kdp);
      if (diff > COVER_SIZE_TOLERANCE_IN) {
        fails.push({ area: "spec", message: `The hardcover cover is ${round(cg.width / 72, 3)}" x ${round(cg.height / 72, 3)}", but KDP's calculator says ${kdp.widthIn}" x ${kdp.heightIn}" (${round(diff, 3)}" off).` });
        fix = { id: "adopt-kdp-cover-size", label: "Use KDP's cover size" };
      }
    }
  }

  const sizeNote = `${round(cg.width / 72, 3)}" x ${round(cg.height / 72, 3)}" cover, spine ${round(cg.spine / 72, 3)}"`;
  if (fails.length) return { id: "hardcover", title: "Hardcover", status: "fail", summary: `${fails.length} hardcover problem(s)`, issues: [...fails, ...warns], fix };
  if (warns.length) return { id: "hardcover", title: "Hardcover", status: "warn", summary: `${warns.length} hardcover item(s) to finish`, issues: warns };
  return { id: "hardcover", title: "Hardcover", status: "pass", summary: `Ready: ${sizeNote}, matches KDP's calculator`, issues: [] };
}
