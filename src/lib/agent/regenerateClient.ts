"use client";

import { produce } from "immer";
import { callAi, isModelOutput, modelRun } from "@/lib/ai/client";
import { isArtTemplate, suggestArtTemplate, type ArtTemplateId } from "@/lib/cover/art";
import { designCover, directArt, generateCandidates, imageStatus, pickCandidate } from "@/lib/cover/artClient";
import { PALETTES, suggestTemplate } from "@/lib/cover/templates";
import { coverSettings } from "@/lib/cover/settings";
import { resolveCategories, suggestCategories } from "@/lib/kdp/categories";
import { coverGeometry } from "@/lib/kdp/geometry";
import { cleanKeywords } from "@/lib/metadata/validate";
import { describeInterior, listingFacts, trimLabel } from "@/lib/quality";
import type { ModelRun, Project, TitleOption } from "@/lib/schema/project";
import { syncTitlePage } from "./autopilot";
import { ART_CANDIDATES } from "./constants";
import { contentCall } from "./content";
import { canRegenerate as canRegenerateSection, chapterSection, regenerateChapter, regenerateSection } from "./regenerate";
import { checkTitleIdeas, mysteryAvoid, mysteryContents, titleRequest } from "./titles";
import { routeOffline } from "./chat";
import type { ChatIntentOutput, TaskInput } from "@/lib/ai/tasks";
import type { MysteryAsk } from "./mystery";
import { genreOfProject } from "@/lib/cover/genres";
import { keepCandidates } from "@/lib/cover/artLibrary";
import { keepInLibrary } from "@/lib/storage/artLibrary";

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

export { coverSettings } from "@/lib/cover/settings";

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

/**
 * Swap in one of the titles named from the book's content: the listing, the
 * title page and the cover (in its current style) all change to match. No
 * model call, so nothing new to disclose.
 */
export async function applyTitle(project: Project, option: TitleOption): Promise<Regenerated> {
  let next = produce(project, (d) => {
    d.metadata.title = option.title;
    if (option.subtitle.trim()) d.metadata.subtitle = option.subtitle.trim();
    d.name = option.title;
    if (option.hero.trim()) d.brief.titleHero = option.hero.trim();
    else delete d.brief.titleHero;
    // The chosen title goes first, as autopilot left it.
    if (d.brief.titleOptions) d.brief.titleOptions = [option, ...d.brief.titleOptions.filter((o) => o.title !== option.title)];
  });
  next = syncTitlePage(next);
  next = await designCover(next, coverSettings(next));
  return { project: next, summary: `Retitled "${option.title}"; the title page and cover were updated to match.` };
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
    const gen = await generateCandidates(direction.concepts, layout, coverGeometry(project.spec, project.interior.pages.length), signal, genreOfProject(project).artStyle);
    runs.push(...gen.runs);
    keepInLibrary(project, gen.candidates, gen.runs);
    const pick = await pickCandidate(project, gen.candidates, layout, palette, signal);
    if (pick.run) runs.push(pick.run);
    let next = produce(project, (d) => {
      const prev = d.coverArt?.candidates ?? [];
      d.coverArt = { candidates: keepCandidates([...gen.candidates, ...prev], gen.candidates[pick.index].id), chosenId: gen.candidates[pick.index].id, pickReason: pick.reason };
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

/** Rewrite one chapter of a mystery with feedback, keeping its clues (needs the case plan autopilot stored). */
export async function regenerateChapterWithAi(project: Project, chapter: number, feedback: string, signal?: AbortSignal): Promise<Regenerated> {
  if (!project.mystery) throw new Error("This book has no stored case plan, so its chapters can't be rewritten here. Edit the chapter in the studio instead.");
  const runs: ModelRun[] = [];
  const ask: MysteryAsk = async (task, input, outputs) => {
    const res = await callAi(task, input as never, signal);
    if (!isModelOutput(res.meta)) return { output: res.output as never };
    const run = modelRun(res.meta, outputs);
    runs.push(run);
    return { output: res.output as never, runId: run.id };
  };
  const r = await regenerateChapter(project, project.mystery, chapter, feedback, ask);
  return { project: withRuns(r.project, runs.filter((x) => x.id === r.runId)), summary: r.summary };
}

/** Name the book again from its content, with the publisher's direction, and use the best new title. */
export async function retitleWithAi(project: Project, feedback: string, signal?: AbortSignal): Promise<Regenerated> {
  const facts = listingFacts(project);
  const plan = project.mystery;
  const avoid = plan ? mysteryAvoid(plan) : [];
  const res = await callAi(
    "title-ideas",
    titleRequest({ bookType: project.bookType, topic: facts.topic, audience: facts.audience || "adults", angle: project.brief.angle, keywordIdeas: project.brief.keywordIdeas, contents: plan ? mysteryContents(plan) : describeInterior(project), avoid, provisional: project.metadata.title || project.name }, feedback),
    signal,
  );
  const checked = checkTitleIdeas(res.output, avoid);
  if (!checked.ideas.length) return { project, summary: "None of the new titles could be used (too long, or giving the ending away), so the title stays as it is." };
  const run = isModelOutput(res.meta) ? modelRun(res.meta, ["listing.title"]) : null;
  const withOptions = produce(project, (d) => {
    d.brief.titleOptions = checked.ideas;
    d.brief.titleIdeas = checked.ideas.map((x) => x.title);
    if (run) d.modelRuns.push(run);
  });
  const r = await applyTitle(withOptions, checked.ideas[0]);
  return { project: r.project, summary: `${r.summary} ${checked.ideas.length - 1} other idea(s) are under it.` };
}

/** What a chat message is about: the model's reading, or the rule-based one offline or when the call fails. */
export async function routeMessage(input: TaskInput<"chat-intent">, signal?: AbortSignal): Promise<ChatIntentOutput> {
  try {
    return (await callAi("chat-intent", input, signal)).output;
  } catch (e) {
    if (signal?.aborted) throw e;
    return routeOffline(input);
  }
}

/** The routing input for a project: its chapters (mysteries) and sections. */
export function intentInput(project: Project | null, message: string, phase: "building" | "done"): TaskInput<"chat-intent"> {
  return {
    message: message.slice(0, 2000),
    phase,
    bookType: project?.bookType ?? "",
    title: project?.metadata.title || project?.name || "",
    chapters: project?.mystery?.chapters.map((c) => c.title) ?? [],
    sections: project?.interior.sections.filter((s) => s.role === "body" && !("part" in s.config && s.config.part === "solutions")).map((s) => s.label) ?? [],
  };
}

/**
 * Apply a chat message to a finished draft: the part it is about is redone
 * with the message as feedback. Plan-level changes can't be made to a built
 * book without rebuilding it, so those say so instead.
 */
export async function reviseFromChat(project: Project, intent: ChatIntentOutput, message: string, signal?: AbortSignal): Promise<Regenerated | null> {
  const feedback = (intent.instruction.trim() || message).slice(0, 500);
  switch (intent.target) {
    case "chapter":
      if (project.mystery && chapterSection(project, intent.chapter)) return regenerateChapterWithAi(project, intent.chapter, feedback, signal);
      break;
    case "section": {
      const sec = project.interior.sections.find((s) => s.label === intent.section) ?? project.interior.sections.find((s) => s.label.toLowerCase().includes(intent.section.toLowerCase()) && intent.section.trim());
      if (sec) return regenerateSectionWithAi(project, sec.id, feedback, signal);
      break;
    }
    case "title":
      return retitleWithAi(project, feedback, signal);
    case "listing":
      return regenerateListingWithAi(project, feedback, signal);
    case "cover":
      return regenerateCoverWithAi(project, feedback, signal);
    case "content": {
      // Throughout the book: a mystery's chapters one by one would be a rebuild; other books redo their content sections.
      if (project.mystery) return null;
      let next = project;
      const done: string[] = [];
      for (const sec of project.interior.sections.filter((s) => s.role === "body" && canRegenerateSection(s))) {
        next = (await regenerateSectionWithAi(next, sec.id, feedback, signal)).project;
        done.push(sec.label);
      }
      return done.length ? { project: next, summary: `Redid ${done.join(", ")} with that in mind.` } : null;
    }
  }
  return null;
}
