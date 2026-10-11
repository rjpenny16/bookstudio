import {
  bleedArea,
  boxContains,
  boxesIntersect,
  coverGeometry,
  findTrim,
  interiorGeometry,
  royaltyUsd,
  safeArea,
  type Box,
} from "@/lib/kdp/geometry";
import {
  LOW_IMAGE_DPI_ERROR,
  MAX_CONSECUTIVE_BLANK_BODY,
  MAX_CONSECUTIVE_BLANK_END,
  MIN_IMAGE_DPI,
  RULES_VERSION,
  isValidPaperInk,
  pageRange,
} from "@/lib/kdp/rules";
import { validateListing } from "@/lib/metadata/validate";
import { pageNumberElement } from "@/lib/render/pageNumbers";
import { FONTS } from "@/lib/render/fonts";
import { elementBounds, elementLabel } from "@/lib/schema/elements";
import { isLowContent, type Element, type Project } from "@/lib/schema/project";
import { round, ptToIn } from "@/lib/util/ids";
import { aiUsage } from "./aiUsage";

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export type FixId =
  | "pad-even"
  | "pad-min"
  | "move-into-safe"
  | "remove-spine-text"
  | "clear-barcode"
  | "clean-keywords"
  | "suggest-ai-disclosure"
  | "fix-paper-ink";

export interface Issue {
  message: string;
  area: "interior" | "cover" | "listing" | "spec";
  pageIndex?: number;
  elementId?: string;
}

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  issues: Issue[];
  fix?: { id: FixId; label: string };
}

export interface PreflightReport {
  rulesVersion: string;
  checkedAt: string;
  checks: Check[];
  passed: number;
  total: number;
  blocking: number;
}

const MAX_ISSUES = 60;

function check(id: string, title: string, issues: Issue[], failIf: boolean, okSummary: string, badSummary: string, fix?: Check["fix"], warnOnly = false): Check {
  const bad = issues.length > 0 && failIf;
  return {
    id,
    title,
    status: bad ? (warnOnly ? "warn" : "fail") : "pass",
    summary: bad ? badSummary : okSummary,
    issues: issues.slice(0, MAX_ISSUES),
    fix: bad ? fix : undefined,
  };
}

function isBackground(el: Element, area: Box): boolean {
  if (el.type === "text" || el.type === "image") return false;
  const b = elementBounds(el);
  return b.width * b.height >= area.width * area.height * 0.5;
}

export function effectiveDpi(project: Project, el: Extract<Element, { type: "image" }>): number | null {
  const asset = project.assets.find((a) => a.id === el.assetId);
  if (!asset) return null;
  const w = Math.min(asset.widthPx, asset.upscaledFrom?.widthPx ?? Infinity);
  const h = Math.min(asset.heightPx, asset.upscaledFrom?.heightPx ?? Infinity);
  return Math.min(w / ptToIn(el.width), h / ptToIn(el.height));
}

export function runPreflight(project: Project): PreflightReport {
  const checks: Check[] = [];
  const pages = project.interior.pages;
  const n = pages.length;
  const spec = project.spec;

  // 1. Trim & paper
  {
    const issues: Issue[] = [];
    if (!findTrim(spec.trimId)) issues.push({ area: "spec", message: `Trim ${spec.widthIn}" x ${spec.heightIn}" is not a standard KDP paperback size.` });
    if (!isValidPaperInk(spec.paper, spec.ink)) issues.push({ area: "spec", message: "Cream paper is only available with black ink." });
    checks.push(check("trim", "Trim size & paper", issues, true, `${spec.widthIn}" x ${spec.heightIn}", ${spec.paper} paper, ${spec.ink} ink`, "Print specification is not offered by KDP", isValidPaperInk(spec.paper, spec.ink) ? undefined : { id: "fix-paper-ink", label: "Switch to white paper" }));
  }

  // 2. Page count
  {
    const range = pageRange(spec.ink, spec.paper);
    const issues: Issue[] = [];
    if (n < range.min) issues.push({ area: "interior", message: `${n} pages; KDP requires at least ${range.min}.` });
    if (n > range.max) issues.push({ area: "interior", message: `${n} pages; the maximum for this paper/ink is ${range.max}.` });
    const c = check("page-count", "Page count", issues, true, `${n} pages (allowed ${range.min}–${range.max})`, "Page count is outside KDP limits", n < range.min ? { id: "pad-min", label: `Add ${range.min - n} blank pages` } : undefined);
    if (c.status === "pass" && n % 2 === 1) {
      c.status = "warn";
      c.summary = `${n} pages is odd; KDP will add a blank last page`;
      c.issues = [{ area: "interior", message: "Odd page counts get a blank page appended at print." }];
      c.fix = { id: "pad-even", label: "Add a blank last page" };
    }
    checks.push(c);
  }

  // 3. Interior margins & bleed
  const g = interiorGeometry(spec, n);
  {
    const fails: Issue[] = [];
    const warns: Issue[] = [];
    let reachesEdge = false;
    pages.forEach((page, i) => {
      const safe = safeArea(g, i);
      const bleed = bleedArea(g, i);
      const trim = { x: 0, y: 0, width: g.trimW, height: g.trimH };
      const els = [...page.elements];
      if (project.interior.pageNumbers.enabled && i + 1 >= project.interior.pageNumbers.startAt && !page.hideNumber) els.push(pageNumberElement(project, i));
      for (const el of els) {
        const b = elementBounds(el);
        if (boxContains(safe, b, 0.5)) continue;
        if (!boxContains(trim, b, 0.5)) reachesEdge = true;
        const label = el.id.startsWith("pn_") ? "Page number" : elementLabel(el);
        if (el.type === "text") {
          fails.push({ area: "interior", pageIndex: i, elementId: el.id, message: `Page ${i + 1}: text "${label}" is outside the live area (gutter ${round(ptToIn(g.gutter))}", outside ${round(ptToIn(g.outside))}").` });
        } else if (!spec.bleed) {
          fails.push({ area: "interior", pageIndex: i, elementId: el.id, message: `Page ${i + 1}: ${label} extends into the margin. Move it or enable bleed.` });
        } else if (!boxContains(bleed, b, 0.5)) {
          warns.push({ area: "interior", pageIndex: i, elementId: el.id, message: `Page ${i + 1}: ${label} extends past the bleed edge and will be cut.` });
        } else if (!isBackground(el, trim)) {
          warns.push({ area: "interior", pageIndex: i, elementId: el.id, message: `Page ${i + 1}: ${label} sits in the margin; trim variance may cut it.` });
        }
      }
    });
    const c = check("interior-margins", "Interior margins", fails, true, `All content inside the live area (gutter ${round(ptToIn(g.gutter))}" for ${n} pages)`, `${fails.length} element(s) outside the live area`, { id: "move-into-safe", label: "Move content into the live area" });
    if (c.status === "pass" && warns.length) {
      c.status = "warn";
      c.summary = `${warns.length} element(s) in the margin/bleed zone`;
      c.issues = warns.slice(0, MAX_ISSUES);
      c.fix = { id: "move-into-safe", label: "Move content into the live area" };
    }
    checks.push(c);
    const bleedCheck: Check = {
      id: "bleed",
      title: "Bleed",
      status: "pass",
      summary: spec.bleed ? "Bleed on: pages are trim + 0.125\" on the outside edge and +0.25\" in height" : "No bleed: nothing prints to the edge",
      issues: [],
    };
    if (spec.bleed && !reachesEdge) {
      bleedCheck.status = "info";
      bleedCheck.summary = "Bleed is on but nothing prints to the edge; turning it off allows smaller margins.";
    }
    checks.push(bleedCheck);
  }

  // 4. Blank pages
  {
    const issues: Issue[] = [];
    let run = 0;
    let runStart = 0;
    const flush = (endIndex: number, atEnd: boolean) => {
      const limit = atEnd ? MAX_CONSECUTIVE_BLANK_END : MAX_CONSECUTIVE_BLANK_BODY;
      if (run > limit) issues.push({ area: "interior", pageIndex: runStart, message: `Pages ${runStart + 1}–${endIndex}: ${run} consecutive blank pages (limit ${limit}${atEnd ? " at the end" : ""}).` });
    };
    pages.forEach((p, i) => {
      if (p.elements.length === 0) {
        if (run === 0) runStart = i;
        run++;
      } else {
        if (run) flush(i, false);
        run = 0;
      }
    });
    if (run) flush(n, true);
    checks.push(check("blank-pages", "Blank pages", issues, true, "No excessive runs of blank pages", "Too many consecutive blank pages", undefined, true));
  }

  // 5. Images
  {
    const fails: Issue[] = [];
    const warns: Issue[] = [];
    const scan = (els: Element[], area: "interior" | "cover", pageIndex?: number) => {
      for (const el of els) {
        if (el.type !== "image") continue;
        const dpi = effectiveDpi(project, el);
        const where = area === "cover" ? "Cover" : `Page ${(pageIndex ?? 0) + 1}`;
        if (dpi === null) fails.push({ area, pageIndex, elementId: el.id, message: `${where}: image asset is missing.` });
        else if (dpi < LOW_IMAGE_DPI_ERROR) fails.push({ area, pageIndex, elementId: el.id, message: `${where}: image is ${Math.round(dpi)} DPI (minimum ${LOW_IMAGE_DPI_ERROR}, recommended ${MIN_IMAGE_DPI}).` });
        else if (dpi < MIN_IMAGE_DPI) warns.push({ area, pageIndex, elementId: el.id, message: `${where}: image is ${Math.round(dpi)} DPI (recommended ${MIN_IMAGE_DPI}).` });
      }
    };
    pages.forEach((p, i) => scan(p.elements, "interior", i));
    scan(project.cover.elements, "cover");
    const c = check("images", "Image resolution", fails, true, "All images at print resolution", `${fails.length} image(s) below print resolution`);
    if (c.status === "pass" && warns.length) {
      c.status = "warn";
      c.summary = `${warns.length} image(s) below ${MIN_IMAGE_DPI} DPI`;
      c.issues = warns;
    }
    checks.push(c);
  }

  // 6. Fonts
  {
    const known = new Set(FONTS.map((f) => f.family));
    const issues: Issue[] = [];
    const used = new Set<string>();
    const scan = (els: Element[], area: "interior" | "cover", pageIndex?: number) => {
      for (const el of els)
        if (el.type === "text") {
          used.add(el.fontFamily);
          if (!known.has(el.fontFamily)) issues.push({ area, pageIndex, elementId: el.id, message: `Font "${el.fontFamily}" is not available for embedding.` });
        }
    };
    pages.forEach((p, i) => scan(p.elements, "interior", i));
    scan(project.cover.elements, "cover");
    checks.push(check("fonts", "Fonts embedded", issues, true, `${used.size} font(s), all embedded in the PDF`, "Some fonts cannot be embedded"));
  }

  // 7. Cover
  const cg = coverGeometry(spec, n);
  {
    const fails: Issue[] = [];
    const warns: Issue[] = [];
    const panels = [cg.backSafe, cg.frontSafe, cg.spineSafe];
    const full = { x: 0, y: 0, width: cg.width, height: cg.height };
    for (const el of project.cover.elements) {
      const b = elementBounds(el);
      const label = elementLabel(el);
      if (!boxesIntersect(b, full)) {
        warns.push({ area: "cover", elementId: el.id, message: `${label} is entirely off the cover.` });
        continue;
      }
      if (el.type === "text") {
        if (!panels.some((p) => boxContains(p, b, 0.5))) fails.push({ area: "cover", elementId: el.id, message: `Text "${label}" is outside the safe zone of the front, back or spine.` });
      } else if (el.type === "image" && !boxContains(full, b, 0.5)) {
        warns.push({ area: "cover", elementId: el.id, message: `${label} extends past the cover bleed edge.` });
      }
    }
    const c = check("cover-safe", "Cover safe zones", fails, true, `Cover ${round(ptToIn(cg.width))}" x ${round(ptToIn(cg.height))}" incl. bleed; spine ${round(ptToIn(cg.spine), 4)}"`, `${fails.length} cover text element(s) outside safe zones`, { id: "move-into-safe", label: "Move text into safe zones" });
    if (c.status === "pass" && warns.length) {
      c.status = "warn";
      c.summary = `${warns.length} cover element(s) need attention`;
      c.issues = warns;
    }
    checks.push(c);
  }

  // 8. Spine text
  {
    const issues: Issue[] = [];
    if (!cg.spineTextAllowed) {
      for (const el of project.cover.elements) {
        if (el.type !== "text") continue;
        const b = elementBounds(el);
        if (boxesIntersect(b, cg.spineBox) && !boxContains(cg.backSafe, b) && !boxContains(cg.frontSafe, b))
          issues.push({ area: "cover", elementId: el.id, message: `"${elementLabel(el)}" is on the spine, but spine text needs at least 80 pages (book has ${n}).` });
      }
    }
    checks.push(check("spine", "Spine text", issues, true, cg.spineTextAllowed ? "Spine text allowed (80+ pages)" : `No spine text (requires 80+ pages)`, "Spine text on a book under 80 pages", { id: "remove-spine-text", label: "Remove spine text" }));
  }

  // 9. Barcode area
  {
    const issues: Issue[] = [];
    if (project.cover.barcode === "kdp") {
      for (const el of project.cover.elements) {
        if (el.type !== "text" && el.type !== "image") continue;
        if (boxesIntersect(elementBounds(el), cg.barcode)) issues.push({ area: "cover", elementId: el.id, message: `"${elementLabel(el)}" overlaps the barcode area (2" x 1.2", lower right of the back cover).` });
      }
    }
    checks.push(check("barcode", "Barcode area", issues, true, project.cover.barcode === "kdp" ? "Barcode area is clear for KDP" : "You supply your own barcode", "Content overlaps the barcode area", { id: "clear-barcode", label: "Move content out of the barcode area" }));
  }

  // 10. Listing metadata
  {
    const v = validateListing(project.metadata, project.bookType);
    const fails = v.errors.map((m) => ({ area: "listing" as const, message: m }));
    const c = check("metadata", "Listing metadata", fails, true, "Title, author, description and keywords are complete", `${fails.length} listing problem(s)`, v.cleanable ? { id: "clean-keywords", label: "Clean up keywords" } : undefined);
    const r = royaltyUsd(spec, n, project.metadata.listPriceUsd);
    const warns = v.warnings.map((m) => ({ area: "listing" as const, message: m }));
    if (r.royalty < 0) fails.push({ area: "listing", message: `List price $${project.metadata.listPriceUsd.toFixed(2)} is below printing cost; minimum is $${r.minListPrice.toFixed(2)}.` });
    if (fails.length) {
      c.status = "fail";
      c.summary = `${fails.length} listing problem(s)`;
      c.issues = [...fails, ...warns];
    } else if (warns.length) {
      c.status = "warn";
      c.summary = `${warns.length} listing suggestion(s)`;
      c.issues = warns;
      c.fix = v.cleanable ? { id: "clean-keywords", label: "Clean up keywords" } : undefined;
    }
    checks.push(c);
  }

  // 11. Low-content / ISBN
  {
    const issues: Issue[] = [];
    const low = isLowContent(project.bookType);
    if (low && project.metadata.isbn.kind === "kdp-free") issues.push({ area: "listing", message: "Low-content books are not eligible for a free KDP ISBN. Use no ISBN or your own." });
    if (project.metadata.isbn.kind === "own" && !/^(97[89])?\d{9}[\dX]$/.test(project.metadata.isbn.value.replace(/[-\s]/g, ""))) issues.push({ area: "listing", message: "Your ISBN does not look like a valid ISBN-10/13." });
    const c = check("isbn", "ISBN & low-content", issues, true, low ? "Low-content book: no free ISBN, no Expanded Distribution" : "Not low-content (puzzle/coloring/activity books are not low-content)", "ISBN choice is not allowed");
    if (c.status === "pass") c.status = "info";
    checks.push(c);
  }

  // 12. AI disclosure
  {
    const usage = aiUsage(project);
    const d = project.metadata.aiDisclosure;
    const issues: Issue[] = [];
    if (usage.text && d.text === "none") issues.push({ area: "listing", message: `AI-generated text is present (${usage.textSources.slice(0, 3).join(", ")}); KDP requires disclosing it.` });
    if (usage.images && d.images === "none") issues.push({ area: "listing", message: "AI-generated images are present; KDP requires disclosing them." });
    if (!d.confirmed) issues.push({ area: "listing", message: "Confirm the AI disclosure answers you will give KDP." });
    const c = check("ai-disclosure", "AI disclosure", issues, true, usage.text || usage.images ? "AI content disclosed and confirmed" : "No AI-generated content; disclosure confirmed", "AI disclosure incomplete", { id: "suggest-ai-disclosure", label: "Fill in from provenance" });
    if (issues.length === 1 && !d.confirmed && !(usage.text && d.text === "none") && !(usage.images && d.images === "none")) {
      c.status = "warn";
      c.fix = undefined;
    }
    checks.push(c);
  }

  const passed = checks.filter((c) => c.status === "pass" || c.status === "info").length;
  return {
    rulesVersion: RULES_VERSION,
    checkedAt: new Date().toISOString(),
    checks,
    passed,
    total: checks.length,
    blocking: checks.filter((c) => c.status === "fail").length,
  };
}
