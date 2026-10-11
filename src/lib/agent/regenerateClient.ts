"use client";

import { produce } from "immer";
import { callAi, isModelOutput, modelRun } from "@/lib/ai/client";
import { isArtTemplate, suggestArtTemplate, type ArtTemplateId } from "@/lib/cover/art";
import { designCover, directArt, generateCandidates, imageStatus, pickCandidate } from "@/lib/cover/artClient";
import { PALETTES, suggestTemplate } from "@/lib/cover/templates";
import { resolveCategories, suggestCategories } from "@/lib/kdp/categories";
import { coverGeometry } from "@/lib/kdp/geometry";
import { cleanKeywords } from "@/lib/metadata/validate";
import { describeInterior, listingFacts, trimLabel } from "@/lib/quality";
import type { ModelRun, Project } from "@/lib/schema/project";
import { syncTitlePage } from "./autopilot";
import { ART_CANDIDATES } from "./constants";
import { contentCall } from "./content";
import { regenerateSection } from "./regenerate";

/**
 * The Review screen's "Regenerate with feedback" actions. Each reruns one
 * part of the book with the publisher's note and records its model runs, so
 * the AI disclosure stays accurate.
 */

export interface Regenerated {
  project: Project;
  summary: string;
}

const withRuns = (project: Project, runs: ModelRun[]) =>
  runs.length
    ? produce(project, (d) => {
        d.modelRuns.push(...runs);
      })
    : project;

export async function regenerateSectionWithAi(project: Project, sectionId: string, feedback: string, signal?: AbortSignal): Promise<Regenerated> {
  const runs: ModelRun[] = [];
  const ctx = { audience: project.brief.audience || "adults", bookTitle: project.metadata.title || project.name };
  const r = await regenerateSection(project, sectionId, feedback, async (req) => {
    const c = contentCall(req, ctx);
    const res = await callAi(c.task, c.input, signal);
    if (!isModelOutput(res.meta)) return { output: res.output };
    const run = modelRun(res.meta, c.outputs);
    runs.push(run);
    return { output: res.output, runId: run.id };
  });
  // Only runs whose output made it into the book count for provenance.
  const used = new Set(r.project.interior.sections.flatMap((s) => ("aiRunId" in s.config && s.config.aiRunId ? [s.config.aiRunId] : [])));
  return { project: withRuns(r.project, runs.filter((x) => used.has(x.id))), summary: r.summary };
}

/** Cover settings to keep when rebuilding: template, palette, back blurb, and which back-cover extras are on. */
export function coverSettings(project: Project) {
  const els = project.cover.elements;
  const blurb = els.find((e) => e.type === "text" && e.name === "Back blurb");
  return {
    templateId: project.cover.templateId ?? suggestTemplate(project.bookType),
    palette: PALETTES.find((p) => p.id === project.cover.paletteId) ?? PALETTES[0],
    backText: blurb?.type === "text" ? blurb.text : "",
    inside: els.some((e) => e.name === "Inside heading"),
    thumbs: els.some((e) => e.name === "Back page thumbnail"),
    aiListing: project.modelRuns.some((r) => r.outputs.some((o) => o.startsWith("listing."))),
  };
}

export async function regenerateListingWithAi(project: Project, feedback: string, signal?: AbortSignal): Promise<Regenerated> {
  const m = project.metadata;
  const facts = listingFacts(project);
  const categoryOptions = [...new Set([...suggestCategories(facts, 12), ...m.categories])];
  const res = await callAi(
    "listing",
    {
      topic: facts.topic,
      audience: facts.audience || "adults",
      bookType: project.bookType,
      angle: project.brief.angle,
      workingTitle: m.title || project.name,
      author: m.author,
      interiorSummary: describeInterior(project),
      pageCount: facts.pageCount,
      trim: trimLabel(project),
      keywordIdeas: project.brief.keywordIdeas.length ? project.brief.keywordIdeas : m.keywords,
      categoryOptions,
      feedback,
    },
    signal,
  );
  const L = res.output;
  const run = isModelOutput(res.meta) ? modelRun(res.meta, ["listing.title", "listing.description", "listing.keywords", "listing.backCover"]) : null;
  let next = produce(project, (d) => {
    d.metadata.title = L.title.trim() || d.metadata.title;
    d.metadata.subtitle = L.subtitle;
    d.metadata.description = L.description;
    d.metadata.keywords = cleanKeywords(L.keywords);
    const cats = resolveCategories(L.categories, categoryOptions).categories;
    if (cats.length) d.metadata.categories = cats;
    d.name = d.metadata.title;
    if (run) d.modelRuns.push(run);
  });
  next = syncTitlePage(next);
  const changed = (["title", "subtitle", "description", "keywords", "categories"] as const).filter((k) => JSON.stringify(next.metadata[k]) !== JSON.stringify(m[k]));
  // The cover carries the title, subtitle and blurb, so rebuild it in the same style.
  const c = coverSettings(next);
  next = await designCover(next, { ...c, backText: L.backCoverBlurb || c.backText, listingRunId: run?.id });
  return { project: next, summary: changed.length ? `Rewrote ${changed.join(", ")}; the title page and cover were updated to match.` : "The new draft matched the current listing." };
}

export async function regenerateCoverWithAi(project: Project, feedback: string, signal?: AbortSignal): Promise<Regenerated> {
  const c = coverSettings(project);
  const runs: ModelRun[] = [];
  const useArt = isArtTemplate(c.templateId) && (await imageStatus()).configured;
  if (useArt) {
    const { direction, run } = await directArt(project, ART_CANDIDATES, signal, feedback);
    if (run) runs.push(run);
    const layout: ArtTemplateId = isArtTemplate(c.templateId) ? c.templateId : (direction.layout ?? suggestArtTemplate(project.bookType));
    const palette = PALETTES.find((p) => p.id === direction.palette) ?? c.palette;
    const gen = await generateCandidates(direction.concepts, layout, coverGeometry(project.spec, project.interior.pages.length), signal);
    runs.push(...gen.runs);
    const pick = await pickCandidate(project, gen.candidates, layout, palette, signal);
    if (pick.run) runs.push(pick.run);
    let next = produce(project, (d) => {
      const prev = d.coverArt?.candidates ?? [];
      d.coverArt = { candidates: [...gen.candidates, ...prev].slice(0, 8), chosenId: gen.candidates[pick.index].id, pickReason: pick.reason };
    });
    next = await designCover(next, { ...c, templateId: layout, palette, candidateId: gen.candidates[pick.index].id });
    const failed = gen.errors.length ? ` ${gen.errors.length} image request(s) failed: ${gen.errors[0]}` : "";
    return { project: withRuns(next, runs), summary: `New art: picked "${gen.candidates[pick.index].name}" of ${gen.candidates.length}. ${pick.reason}${failed}` };
  }
  const res = await callAi(
    "cover-style",
    { title: project.metadata.title || project.name, bookType: project.bookType, topic: project.brief.topic || project.metadata.title, audience: project.brief.audience || "adults", currentTemplate: isArtTemplate(c.templateId) ? suggestTemplate(project.bookType) : c.templateId, currentPalette: c.palette.id, feedback },
    signal,
  );
  if (isModelOutput(res.meta)) runs.push(modelRun(res.meta, ["cover.style"]));
  const palette = PALETTES.find((p) => p.id === res.output.palette) ?? c.palette;
  const next = await designCover(project, { ...c, templateId: res.output.template, palette });
  return { project: withRuns(next, runs), summary: `${res.output.template} template, ${palette.name} palette. ${res.output.reason}` };
}
