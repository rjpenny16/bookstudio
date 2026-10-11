import { findTrim } from "@/lib/kdp/geometry";
import { resolveCategories } from "@/lib/kdp/categories";
import { cleanKeywords, validateListing } from "@/lib/metadata/validate";
import type { ListingMetadata, Project, ProjectReviews } from "@/lib/schema/project";
import { checkBookContent, type ContentIssue, type Severity } from "./content";
import { checkDesign, type DesignNote } from "./design";
import { critiqueListingRules, type ListingFacts, type ListingNote } from "./listing";

/**
 * The quality review: rule-based checks of the content, the design and the
 * listing (recomputed whenever the project changes) plus the latest stored
 * model reviews. Unlike preflight, nothing here blocks export: these are the
 * things that decide whether buyers are happy, not whether KDP accepts the
 * files.
 */

export interface QualityReport {
  content: { sectionId: string; label: string; issues: ContentIssue[] }[];
  design: DesignNote[];
  listing: ListingNote[];
  reviews: ProjectReviews;
  counts: Record<Severity, number>;
}

export function listingFacts(project: Project): ListingFacts {
  return {
    bookType: project.bookType,
    topic: project.brief.topic || project.metadata.title || project.name,
    audience: project.brief.audience,
    pageCount: project.interior.pages.length,
  };
}

export function qualityReport(project: Project): QualityReport {
  const content = checkBookContent(project.interior.sections);
  const design = checkDesign(project);
  const listing = critiqueListingRules(project.metadata, listingFacts(project));
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const s of content) for (const i of s.issues) counts[i.severity]++;
  for (const n of [...design, ...listing]) counts[n.severity]++;
  return { content, design, listing, reviews: project.reviews ?? {}, counts };
}

/** True when the book is aimed at large-print readers. */
export function isLargePrint(project: Project): boolean {
  return /large[- ]print|senior|low vision|elderly/i.test(`${project.brief.topic} ${project.brief.audience} ${project.brief.notes} ${project.metadata.title} ${project.metadata.subtitle}`);
}

/** Plain summary of the interior from its sections (or page generators for hand-built books). */
export function describeInterior(project: Project): string {
  if (project.brief.interiorPlan.trim()) return project.brief.interiorPlan;
  const kinds = new Map<string, number>();
  for (const p of project.interior.pages) {
    const k = p.generator?.kind ?? "custom";
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  return [...kinds.entries()].map(([k, c]) => `${c} ${k.replace(/-/g, " ")} pages`).join(", ");
}

export const trimLabel = (project: Project) => findTrim(project.spec.trimId)?.label ?? `${project.spec.widthIn}x${project.spec.heightIn}`;

/**
 * Apply a critic's revised listing, field by field, as long as it doesn't
 * introduce listing errors. Returns the new metadata and which fields changed.
 */
export function applyRevisedListing(project: Project, revised: NonNullable<NonNullable<ProjectReviews["listing"]>["revised"]>): { metadata: ListingMetadata; changed: string[] } {
  const before = project.metadata;
  const baseErrors = validateListing(before, project.bookType).errors.length;
  const next: ListingMetadata = {
    ...before,
    title: revised.title.trim() || before.title,
    subtitle: revised.subtitle.trim(),
    description: revised.description.trim() || before.description,
    keywords: revised.keywords.length ? cleanKeywords(revised.keywords) : before.keywords,
    categories: resolveCategories(revised.categories, revised.categories.length ? [] : before.categories).categories,
  };
  if (!next.categories.length) next.categories = before.categories;
  if (validateListing(next, project.bookType).errors.length > baseErrors) return { metadata: before, changed: [] };
  const changed = (["title", "subtitle", "description", "keywords", "categories"] as const).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  return { metadata: next, changed };
}
