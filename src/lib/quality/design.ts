import { SQUARE_NUMBER } from "@/lib/generators/pages";
import { LARGE_PRINT_MIN_PT } from "@/lib/generators/style";
import { interiorStats } from "./interior";
import { coverGeometry, type Box } from "@/lib/kdp/geometry";
import { elementBounds } from "@/lib/schema/elements";
import type { Element, Project } from "@/lib/schema/project";
import { contrastRatio, LARGE_TEXT_CONTRAST, TEXT_CONTRAST } from "@/lib/util/color";
import type { Severity } from "./content";
import { coverKey } from "./coverScore";

/**
 * Rule-based design checks that need no model: text contrast on the cover,
 * whether the title survives being shrunk to an Amazon search thumbnail, and
 * interior text too small to read in print. The model's visual review covers
 * the judgement calls these can't make.
 */

export interface DesignNote {
  area: "cover" | "interior";
  severity: Severity;
  issue: string;
  suggestion: string;
  elementId?: string;
  pageIndex?: number;
}

/** Height of a small Amazon search-result thumbnail, in pixels. */
export const THUMBNAIL_PX = 160;

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** The color drawn behind `el`: the topmost opaque filled shape under its center, else the cover background. */
export function backdrop(elements: Element[], el: Element, fallback: string): string {
  const idx = elements.indexOf(el);
  const c = center(elementBounds(el));
  for (let i = idx - 1; i >= 0; i--) {
    const e = elements[i];
    if ((e.type === "rect" || e.type === "ellipse" || e.type === "path") && e.fill && (e.opacity ?? 1) >= 0.6 && inside(c, elementBounds(e))) return e.fill;
  }
  return fallback;
}

export function checkDesign(project: Project): DesignNote[] {
  const notes: DesignNote[] = [];
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const els = project.cover.elements;
  // Puzzle motifs on the front are decoration, not copy.
  const frontText = els.filter((e): e is Extract<Element, { type: "text" }> => e.type === "text" && !e.name?.startsWith("Motif") && inside(center(elementBounds(e)), cg.front));
  // Contrast measured on the rendered pixels (art included) when the cover hasn't changed since; else the shape behind the text.
  const a = project.cover.analysis;
  const measured = a && a.key === coverKey(project.cover) ? new Map(a.textContrast.map((t) => [t.elementId, t.ratio])) : null;

  if (!frontText.length) {
    if (els.length) notes.push({ area: "cover", severity: "high", issue: "The front cover has no text.", suggestion: "KDP requires the title on the front cover, and it should match the listing title." });
  } else {
    const title = frontText.find((e) => e.name === "Title") ?? [...frontText].sort((a, b) => b.fontSize - a.fontSize)[0];
    const px = (title.fontSize * THUMBNAIL_PX) / cg.front.height;
    if (px < 5) notes.push({ area: "cover", severity: "high", elementId: title.id, issue: `The title would be about ${px.toFixed(1)} px tall in a ${THUMBNAIL_PX} px search thumbnail.`, suggestion: "Shorten the title on the cover or enlarge it; most buyers first see the cover as a thumbnail." });
    else if (px < 7) notes.push({ area: "cover", severity: "medium", elementId: title.id, issue: `The title would be about ${px.toFixed(1)} px tall in a ${THUMBNAIL_PX} px search thumbnail.`, suggestion: "A larger or shorter title reads better at thumbnail size." });

    for (const t of frontText) {
      const ratio = measured?.get(t.id) ?? contrastRatio(t.color, backdrop(els, t, project.cover.background));
      if (ratio === null) continue;
      const label = t.name ?? `"${t.text.slice(0, 24)}"`;
      const large = t.fontSize >= 18 || (t.bold && t.fontSize >= 14);
      const min = large ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST;
      if (ratio < 2) notes.push({ area: "cover", severity: "high", elementId: t.id, issue: `${label} has very low contrast with what's behind it (${ratio.toFixed(1)}:1).`, suggestion: "Pick a palette or text color with much stronger contrast." });
      else if (ratio < min) notes.push({ area: "cover", severity: "medium", elementId: t.id, issue: `${label} contrast is ${ratio.toFixed(1)}:1 (aim for ${min}:1 or more).`, suggestion: "Darken or lighten the text, or change the shape behind it." });
    }
    if (frontText.length > 6) notes.push({ area: "cover", severity: "low", issue: `${frontText.length} text items on the front cover.`, suggestion: "Busy covers lose the title at thumbnail size; keep the front to title, subtitle and author." });
  }

  // Interior: text too small to read in print (answer keys excepted; they are reference material).
  let tiny = 0;
  let first = -1;
  project.interior.pages.forEach((p, i) => {
    if (p.generator?.kind?.endsWith("-solutions")) return;
    if (p.elements.some((e) => e.type === "text" && e.text.trim() && e.fontSize < 6)) {
      tiny++;
      if (first < 0) first = i;
    }
  });
  if (tiny) notes.push({ area: "interior", severity: "medium", pageIndex: first, issue: `${tiny} page(s) have text smaller than 6 pt.`, suggestion: "Text under 6 pt is hard to read in print; 9-12 pt suits body text, 14 pt+ for large print." });

  // Large print promises 14 pt or more on every page a reader works in.
  const stats = interiorStats(project);
  const largePrint = stats.largePrint || /large[- ]print|low vision/i.test(`${project.metadata.title} ${project.metadata.subtitle}`);
  if (largePrint && stats.pagesUnderLargePrint) {
    const at = project.interior.pages.findIndex((p) => !p.generator?.kind?.endsWith("-solutions") && p.elements.some((e) => e.type === "text" && e.text.trim() && e.name !== SQUARE_NUMBER && e.fontSize < LARGE_PRINT_MIN_PT));
    notes.push({ area: "interior", severity: "medium", pageIndex: at, issue: `${stats.pagesUnderLargePrint} page(s) of a large-print book have text under ${LARGE_PRINT_MIN_PT} pt (smallest ${stats.minReaderPt} pt).`, suggestion: "Large-print readers expect 14 pt or more on every page they read; enlarge labels and word lists." });
  }
  if (stats.dividers >= 2 && stats.dividersOnRecto < stats.dividers)
    notes.push({ area: "interior", severity: "low", issue: `${stats.dividers - stats.dividersOnRecto} of ${stats.dividers} section dividers open on a left-hand page.`, suggestion: "Parts of a printed book usually open on a right-hand page; add a blank page before those dividers." });
  return notes;
}
