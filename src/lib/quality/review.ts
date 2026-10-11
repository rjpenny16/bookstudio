"use client";

import { callAi, isModelOutput, modelRun, type AiImage } from "@/lib/ai/client";
import { resolveCategories, suggestCategories } from "@/lib/kdp/categories";
import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import { cleanKeywords } from "@/lib/metadata/validate";
import { ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import { pageNumberElement } from "@/lib/render/pageNumbers";
import type { ModelRun, Project, ProjectReviews } from "@/lib/schema/project";
import { describeInterior, isLargePrint, listingFacts, trimLabel } from "./index";
import { THUMBNAIL_PX } from "./design";
import { critiqueListingRules } from "./listing";

/**
 * Model reviews that run in the browser: the listing critique, and the visual
 * review, which renders the cover and a sample of pages and sends them to the
 * model as images. Both return a review to store on the project and the model
 * run to record (null for offline output, which is not AI).
 */

type ListingReview = NonNullable<ProjectReviews["listing"]>;
type VisualReview = NonNullable<ProjectReviews["visual"]>;

export async function critiqueListing(project: Project, signal?: AbortSignal): Promise<{ review: ListingReview; run: ModelRun | null }> {
  const facts = listingFacts(project);
  const m = project.metadata;
  const categoryOptions = [...new Set([...suggestCategories(facts, 12), ...m.categories])];
  const rules = critiqueListingRules(m, facts);
  const res = await callAi(
    "listing-critique",
    {
      bookType: project.bookType,
      topic: facts.topic,
      audience: facts.audience || "adults",
      pageCount: facts.pageCount,
      trim: trimLabel(project),
      interiorSummary: describeInterior(project),
      title: m.title,
      subtitle: m.subtitle,
      description: m.description,
      keywords: m.keywords,
      categories: m.categories,
      listPriceUsd: m.listPriceUsd,
      categoryOptions,
      ruleFindings: rules.map((n) => `${n.field}: ${n.issue}`),
    },
    signal,
  );
  const o = res.output;
  const model = isModelOutput(res.meta);
  const review: ListingReview = {
    at: new Date().toISOString(),
    provider: res.meta.provider,
    model: res.meta.model,
    score: o.score,
    summary: o.summary,
    findings: o.findings.map((f) => ({ target: f.field, severity: f.severity, issue: f.issue, suggestion: f.suggestion })),
    revised: model
      ? {
          title: o.revised.title,
          subtitle: o.revised.subtitle,
          description: o.revised.description,
          keywords: cleanKeywords(o.revised.keywords),
          categories: resolveCategories(o.revised.categories, []).categories,
        }
      : undefined,
  };
  return { review, run: model ? modelRun(res.meta, ["review.listing"]) : null };
}

const jpeg = (c: HTMLCanvasElement, quality = 0.85) => c.toDataURL("image/jpeg", quality).split(",")[1];

function scaled(src: HTMLCanvasElement, heightPx: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.height = heightPx;
  c.width = Math.max(1, Math.round((src.width / src.height) * heightPx));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Pages worth showing a reviewer: title page, how-to, first page of each body section, first answer key page. */
export function samplePages(project: Project, max = 7): { index: number; label: string }[] {
  const pages = project.interior.pages;
  const picks: { index: number; label: string }[] = [];
  const add = (index: number, label: string) => {
    if (index >= 0 && picks.length < max && !picks.some((p) => p.index === index)) picks.push({ index, label: `Page ${index + 1} (${label})` });
  };
  add(pages.findIndex((p) => p.generator?.kind === "title-page"), "title page");
  add(pages.findIndex((p) => p.generator?.kind === "text-page"), "how to use");
  for (const s of project.interior.sections) {
    if (s.role !== "body" || s.config.kind === "section-divider") continue;
    add(pages.findIndex((p) => p.sectionId === s.id), s.label);
  }
  add(pages.findIndex((p) => p.generator?.kind?.endsWith("-solutions")), "answer key");
  if (!picks.length && pages.length) add(0, "first page");
  return picks.sort((a, b) => a.index - b.index);
}

/** Render the cover (full wrap and a search-size thumbnail) and sample pages as JPEG images. */
export async function renderReviewImages(project: Project): Promise<AiImage[]> {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const out: AiImage[] = [];
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  if (project.cover.elements.length) {
    const scale = 1400 / cg.width;
    const full = rasterize({ widthPt: cg.width, heightPt: cg.height, scale, background: project.cover.background, elements: project.cover.elements, images });
    out.push({ label: "Cover: back, spine and front", mediaType: "image/jpeg", data: jpeg(full) });
    const front = document.createElement("canvas");
    front.width = Math.round(cg.front.width * scale);
    front.height = Math.round(cg.front.height * scale);
    front.getContext("2d")!.drawImage(full, Math.round(cg.front.x * scale), Math.round(cg.front.y * scale), front.width, front.height, 0, 0, front.width, front.height);
    out.push({ label: `Front cover as a ${THUMBNAIL_PX} px search thumbnail`, mediaType: "image/jpeg", data: jpeg(scaled(front, THUMBNAIL_PX), 0.9) });
  }
  const g = interiorGeometry(project.spec, project.interior.pages.length);
  const pn = project.interior.pageNumbers;
  for (const { index, label } of samplePages(project)) {
    const page = project.interior.pages[index];
    const elements = pn.enabled && index + 1 >= pn.startAt && !page.hideNumber ? [...page.elements, pageNumberElement(project, index)] : page.elements;
    const canvas = rasterize({ widthPt: g.trimW, heightPt: g.trimH, scale: 1000 / g.trimH, background: "#ffffff", elements, images });
    out.push({ label, mediaType: "image/jpeg", data: jpeg(canvas) });
  }
  return out;
}

export async function reviewVisuals(project: Project, signal?: AbortSignal): Promise<{ review: VisualReview; run: ModelRun | null }> {
  const images = await renderReviewImages(project);
  if (!images.length) throw new Error("Nothing to review yet: add a cover or pages first.");
  const res = await callAi(
    "visual-review",
    {
      title: project.metadata.title || project.name,
      bookType: project.bookType,
      audience: project.brief.audience || "adults",
      trim: trimLabel(project),
      pageCount: project.interior.pages.length,
      largePrint: isLargePrint(project),
      images: images.map((i) => i.label),
    },
    signal,
    images,
  );
  const o = res.output;
  const model = isModelOutput(res.meta);
  const review: VisualReview = {
    at: new Date().toISOString(),
    provider: res.meta.provider,
    model: res.meta.model,
    score: o.score,
    summary: o.summary,
    thumbnailReadable: o.thumbnailReadable,
    findings: o.findings,
    images: images.map((i) => i.label),
  };
  return { review, run: model ? modelRun(res.meta, ["review.visual"]) : null };
}
