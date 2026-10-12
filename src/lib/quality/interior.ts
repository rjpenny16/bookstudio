import { SQUARE_NUMBER } from "@/lib/generators/pages";
import { LARGE_PRINT_MIN_PT, styleOf } from "@/lib/generators/style";
import { isRecto } from "@/lib/kdp/geometry";
import type { Page, Project } from "@/lib/schema/project";

/**
 * Measurements of the interior's typography and structure: the smallest text
 * a reader reads, the answer-key text, page numbers, and whether parts open on
 * right-hand pages. Numbers only; `checkDesign` turns the worst into findings.
 */
export interface InteriorStats {
  /** Heading and body faces of the interior style. */
  faces: { heading: string; body: string; label: string };
  largePrint: boolean;
  /** Smallest text on the pages a reader works in (answer keys and page numbers excluded), in points. */
  minReaderPt: number | null;
  /** Pages whose smallest reader text is under the large-print minimum. */
  pagesUnderLargePrint: number;
  /** Smallest text in the answer keys, in points. */
  minKeyPt: number | null;
  pageNumberPt: number;
  /** Section dividers, and how many of them open on a right-hand page. */
  dividers: number;
  dividersOnRecto: number;
}

const isKey = (p: Page) => !!p.generator?.kind?.endsWith("-solutions");

function minText(page: Page): number | null {
  const sizes = page.elements.filter((e) => e.type === "text" && e.text.trim() && e.name !== SQUARE_NUMBER).map((e) => (e.type === "text" ? e.fontSize : Infinity));
  return sizes.length ? Math.min(...sizes) : null;
}

const minOf = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(Math.min(...v) * 10) / 10 : null;
};

export function interiorStats(project: Project): InteriorStats {
  const style = styleOf(project);
  const pages = project.interior.pages;
  const reader = pages.filter((p) => !isKey(p)).map(minText);
  const dividerIdx = pages.map((p, i) => (p.generator?.kind === "section-divider" ? i : -1)).filter((i) => i >= 0);
  return {
    faces: { heading: style.heading.family, body: style.body, label: style.label },
    largePrint: style.largePrint,
    minReaderPt: minOf(reader),
    pagesUnderLargePrint: reader.filter((s) => s !== null && s < LARGE_PRINT_MIN_PT).length,
    minKeyPt: minOf(pages.filter(isKey).map(minText)),
    pageNumberPt: project.interior.pageNumbers.fontSize,
    dividers: dividerIdx.length,
    dividersOnRecto: dividerIdx.filter(isRecto).length,
  };
}
