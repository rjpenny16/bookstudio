import { produce } from "immer";
import { callAi, isModelOutput, modelRun, type AiCallResult } from "@/lib/ai/client";
import type { BlueprintOutput, BriefOutput, TaskName } from "@/lib/ai/tasks";
import { isArtTemplate, suggestArtTemplate } from "@/lib/cover/art";
import { designCover, directArt, generateCandidates, paletteFromArt, pickCandidate } from "@/lib/cover/artClient";
import { PALETTES } from "@/lib/cover/templates";
import { chooseVariant, redesignTarget, storedVariants, type VariantChoice } from "@/lib/cover/variants";
import { coverSettings } from "@/lib/cover/settings";
import { resolveCategories, suggestCategories } from "@/lib/kdp/categories";
import { generatePages } from "@/lib/generators/pages";
import { coverGeometry, findTrim } from "@/lib/kdp/geometry";
import { cleanKeywords, findProhibited } from "@/lib/metadata/validate";
import { runPreflight, type FixId, type PreflightReport } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { applyRevisedListing, qualityReport, type QualityReport } from "@/lib/quality";
import { critiqueListing, reviewVisuals } from "@/lib/quality/review";
import { createProject } from "@/lib/schema/factory";
import type { BookType, ModelRun, Project } from "@/lib/schema/project";
import { assembleBook, clampPageTarget, describeBook, planSections, validateBlueprint, type PlannedSection } from "./blueprint";
import { ART_CANDIDATES } from "./constants";
import { applyContent, contentCall, refineContent, type ContentRequest } from "./content";
import { genreOfProject } from "@/lib/cover/genres";

/**
 * The publishing agent. It is a deterministic workflow with model calls inside
 * it: the model proposes (brief, section plan, copy, prompts, word lists) and
 * validated domain operations build the book. It stops at a human approval
 * gate; it never publishes to KDP.
 */

export interface AutopilotInput {
  topic: string;
  audience: string;
  bookType: BookType;
  trimId: string;
  author: string;
  notes: string;
  /** Generate AI cover art (needs an image provider on the server). */
  coverArt?: boolean;
  /** Interior page count; left to the brief when unset. */
  pageTarget?: number;
  /** Cover template and/or palette; left to the brief (or the art direction) when unset. */
  style?: { templateId?: string; paletteId?: string };
}

/** Called with the draft as it takes shape (pages, then the cover), for the live build view. */
export type PreviewCallback = (project: Project, stage: "layout" | "listing" | "cover" | "done") => void;

export { ART_CANDIDATES } from "./constants";

export type StepStatus = "pending" | "running" | "done" | "error";

export interface AgentStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export const AUTOPILOT_STEPS: { id: string; label: string }[] = [
  { id: "brief", label: "Write publishing brief" },
  { id: "plan", label: "Plan sections & page budget" },
  { id: "content", label: "Write section content" },
  { id: "check", label: "Check content for repeats & weak items" },
  { id: "layout", label: "Lay out interior pages" },
  { id: "listing", label: "Write listing metadata" },
  { id: "critique", label: "Critique & revise listing" },
  { id: "art", label: "Generate & pick cover art" },
  { id: "cover", label: "Design cover" },
  { id: "review", label: "Review rendered cover & pages" },
  { id: "preflight", label: "Run KDP preflight & auto-repair" },
  { id: "provenance", label: "Record provenance & disclosure" },
];

export interface AutopilotResult {
  project: Project;
  report: PreflightReport;
  repairs: string[];
  /** Notes worth showing the user (fallbacks, sections that came back short). */
  notes: string[];
  /** Rule-based quality checks of the finished draft, plus the stored model reviews. */
  quality: QualityReport;
}

/** Covers the visual review scores below this (out of 10) get one redesign. */
const REDESIGN_BELOW = 6;

/** Listing critiques scoring below this (or with a high-severity finding) get their revision applied. */
const REVISE_BELOW = 8;

const AUTO_FIXES: FixId[] = ["pad-min", "pad-even", "move-into-safe", "remove-spine-text", "clear-barcode", "clean-keywords", "suggest-ai-disclosure"];

/** Regenerate the title page when the listing title or subtitle changed after layout, so book, cover and listing agree. */
export function syncTitlePage(project: Project): Project {
  const sec = project.interior.sections.find((s) => s.config.kind === "title-page");
  if (!sec || sec.config.kind !== "title-page") return project;
  const { title, subtitle } = project.metadata;
  if (sec.config.title === title && sec.config.subtitle === subtitle) return project;
  const config = { ...sec.config, title, subtitle };
  const pages = generatePages(config, { spec: project.spec, pageCountHint: project.interior.pages.length }).map((p) => ({ ...p, sectionId: sec.id }));
  return produce(project, (d) => {
    const s = d.interior.sections.find((x) => x.id === sec.id)!;
    s.config = config;
    const first = d.interior.pages.findIndex((p) => p.sectionId === sec.id);
    const count = d.interior.pages.filter((p) => p.sectionId === sec.id).length;
    d.interior.pages.splice(first, count, ...pages);
  });
}

/** Run async jobs with limited parallelism, keeping result order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export async function runAutopilot(
  input: AutopilotInput,
  onStep: (id: string, status: StepStatus, detail?: string) => void,
  signal?: AbortSignal,
  onPreview?: PreviewCallback,
): Promise<AutopilotResult> {
  const runs: ModelRun[] = [];
  const notes: string[] = [];
  const ai = async <T extends TaskName>(task: T, payload: Parameters<typeof callAi<T>>[1], outputs: string[]): Promise<AiCallResult<T> & { runId?: string }> => {
    const res = await callAi(task, payload, signal);
    if (!isModelOutput(res.meta)) return res;
    const run = modelRun(res.meta, outputs);
    runs.push(run);
    return { ...res, runId: run.id };
  };
  const step = async <R,>(id: string, fn: () => Promise<[R, string?]>): Promise<R> => {
    if (signal?.aborted) throw new Error("Cancelled");
    onStep(id, "running");
    try {
      const [value, detail] = await fn();
      onStep(id, "done", detail);
      return value;
    } catch (e) {
      onStep(id, "error", e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const trim = findTrim(input.trimId) ?? findTrim("6x9")!;
  const ctx = { bookType: input.bookType, topic: input.topic, audience: input.audience, notes: input.notes };

  // 1. Brief
  const briefRes = await step("brief", async () => {
    const r = await ai("brief", { topic: input.topic, audience: input.audience, bookType: input.bookType, notes: input.notes, trim: trim.label }, ["brief"]);
    return [r, `${r.output.titleIdeas[0] ?? input.topic} · ${r.meta.provider}`];
  });
  const brief: BriefOutput = briefRes.output;
  const pageTarget = clampPageTarget(input.pageTarget || brief.pageTarget || 120);
  const title = brief.titleIdeas.find((t) => !findProhibited(t).length) ?? input.topic;
  const audience = brief.audience || input.audience;

  // 2. Plan: sections and page budget
  const { blueprint, blueprintRunId, planned } = await step("plan", async () => {
    const r = await ai(
      "blueprint",
      { topic: input.topic, audience, bookType: input.bookType, notes: input.notes, trim: trim.label, title, angle: brief.angle, interiorPlan: brief.interiorPlan, pageTarget },
      ["interior.plan", "interior.how-to", "interior.closing"],
    );
    const checked = validateBlueprint(r.output, { ...ctx, audience });
    if (checked.fallback) notes.push(checked.fallback);
    const bp: BlueprintOutput = checked.blueprint;
    const sections = planSections(bp, { ...ctx, audience, trimId: trim.id, pageTarget });
    return [{ blueprint: bp, blueprintRunId: checked.fallback ? undefined : r.runId, planned: sections }, `${sections.length} section(s): ${sections.map((s) => s.label).join(", ")}`];
  });

  // 3. Content for each section that needs it (prompts, word lists, sayings)
  const write = (req: ContentRequest) => {
    const c = contentCall(req, { audience, bookTitle: title });
    return ai(c.task, c.input, c.outputs);
  };
  const written: PlannedSection[] = await step("content", async () => {
    const out = await pool(planned, 3, async (sec): Promise<PlannedSection> => {
      const need = sec.content;
      if (!need) return sec;
      const r = await write({ need, sectionTitle: sec.label, count: need.count, avoid: [] });
      return { ...sec, config: applyContent(sec.config, need, r.output, r.runId) };
    });
    return [out, describeBook(out)];
  });

  // 3b. Check the whole book's content for repeats and weak items, and replace them.
  const filled: PlannedSection[] = await step("check", async () => {
    const r = await refineContent(written, write);
    notes.push(...r.notes);
    return [r.sections, r.removed ? `${r.removed} replaced or removed, ${r.added} new item(s)` : "No repeats or weak items found"];
  });

  // 4. Layout
  let project = await step("layout", async () => {
    const sections = assembleBook(blueprint, filled, { ...ctx, audience, trimId: trim.id, pageTarget, title, subtitle: brief.subtitle, author: input.author, blueprintRunId });
    const p = createProject({ name: title, bookType: input.bookType, trimId: trim.id, paper: "white", ink: "black", bleed: false, author: input.author, interior: sections });
    return [p, `${p.interior.pages.length} pages in ${p.interior.sections.length} parts`];
  });
  onPreview?.(project, "layout");
  const interiorSummary = describeBook(filled);
  project = produce(project, (d) => {
    d.brief = { topic: input.topic, audience, notes: input.notes, angle: brief.angle, titleIdeas: brief.titleIdeas, ...(brief.titleHero.trim() ? { titleHero: brief.titleHero.trim() } : {}), keywordIdeas: brief.keywordIdeas, interiorPlan: interiorSummary, coverDirection: brief.coverDirection, risks: brief.risks };
  });

  // 5. Listing
  const categoryOptions = suggestCategories({ bookType: input.bookType, topic: input.topic, audience }, 12);
  const listing = await step("listing", async () => {
    const r = await ai(
      "listing",
      {
        topic: input.topic,
        audience,
        bookType: input.bookType,
        angle: brief.angle,
        workingTitle: title,
        author: input.author,
        interiorSummary,
        pageCount: project.interior.pages.length,
        trim: trim.label,
        keywordIdeas: brief.keywordIdeas,
        categoryOptions,
      },
      ["listing.title", "listing.description", "listing.keywords", "listing.backCover"],
    );
    return [r, `${r.output.keywords.length} keywords · ${r.output.description.length} chars`];
  });
  project = produce(project, (d) => {
    const L = listing.output;
    d.metadata.title = L.title || title;
    d.metadata.subtitle = L.subtitle;
    d.metadata.description = L.description;
    d.metadata.keywords = cleanKeywords(L.keywords);
    d.metadata.categories = resolveCategories(L.categories, categoryOptions).categories;
    if (L.suggestedPriceUsd > 0) d.metadata.listPriceUsd = Math.round(L.suggestedPriceUsd * 100) / 100;
    d.name = d.metadata.title;
  });

  // 5b. Critique the listing and apply the revision when it is clearly better.
  project = await step("critique", async () => {
    try {
      const { review, run } = await critiqueListing(project, signal);
      let next = produce(project, (d) => {
        d.reviews = { ...d.reviews, listing: review };
      });
      let detail = run ? `score ${review.score}/10` : "Offline: rule-based listing checks only";
      const weak = review.score < REVISE_BELOW || review.findings.some((f) => f.severity === "high");
      if (run && review.revised && weak) {
        const { metadata, changed } = applyRevisedListing(next, review.revised);
        if (changed.length) {
          next = produce(next, (d) => {
            d.metadata = metadata;
            d.name = metadata.title;
          });
          run.outputs.push(...changed.map((c) => `listing.${c}`));
          detail += `, revised ${changed.join(", ")}`;
        }
      }
      if (run) runs.push(run);
      return [syncTitlePage(next), detail];
    } catch (e) {
      notes.push(`Listing critique skipped: ${e instanceof Error ? e.message : e}`);
      return [syncTitlePage(project), "skipped"];
    }
  });
  onPreview?.(project, "listing");

  // 6. Cover art: art direction, candidates, and a pick (a vision model looks at them when one is available).
  const palette = PALETTES.find((p) => p.id === (input.style?.paletteId ?? brief.palette)) ?? PALETTES[0];
  const chosenTemplate = input.style?.templateId;
  const art = await step("art", async () => {
    if (!input.coverArt) return [null, "Off: no image provider, using a vector template"];
    if (chosenTemplate && !isArtTemplate(chosenTemplate)) return [null, `Off: you chose the ${chosenTemplate} template`];
    try {
      const { direction, run } = await directArt(project, ART_CANDIDATES, signal);
      if (run) runs.push(run);
      const layout = (isArtTemplate(chosenTemplate) ? chosenTemplate : direction.layout) ?? suggestArtTemplate(input.bookType);
      const artPalette = input.style?.paletteId ? palette : (PALETTES.find((p) => p.id === direction.palette) ?? palette);
      const cg = coverGeometry(project.spec, project.interior.pages.length);
      const style = genreOfProject(project).artStyle;
      const gen = await generateCandidates(direction.concepts, layout, cg, signal, style);
      runs.push(...gen.runs);
      if (gen.errors.length) notes.push(`Some cover art failed: ${gen.errors.join("; ")}`);
      let pick = await pickCandidate(project, gen.candidates, layout, artPalette, signal);
      if (pick.run) runs.push(pick.run);
      // Every image had lettering in it: one more try with the rule spelled out, then pick again from all of them.
      if (gen.candidates.length > 1 && pick.textInArt.length === gen.candidates.length) {
        const strict = { ...direction.concepts[0], prompt: `${direction.concepts[0].prompt} The picture must contain no letters, words, numbers, signs or labels of any kind; any sign, book or surface in it is blank.` };
        try {
          const extra = await generateCandidates([strict], layout, cg, signal, style);
          runs.push(...extra.runs);
          gen.candidates.push(...extra.candidates);
          pick = await pickCandidate(project, gen.candidates, layout, artPalette, signal);
          if (pick.run) runs.push(pick.run);
        } catch (e) {
          if (signal?.aborted) throw e;
        }
        if (pick.textInArt.includes(pick.index)) notes.push("The cover art may contain stray lettering; check it closely or regenerate it.");
      }
      project = produce(project, (d) => {
        d.coverArt = { candidates: gen.candidates, chosenId: gen.candidates[pick.index].id, pickReason: pick.reason };
      });
      return [{ layout, palette: artPalette }, `${gen.candidates.length} candidate(s), picked "${gen.candidates[pick.index].name}"`];
    } catch (e) {
      if (signal?.aborted) throw e;
      notes.push(`Cover art skipped: ${e instanceof Error ? e.message : e}`);
      return [null, "skipped, using a vector template"];
    }
  });

  // 6b. Cover layout: art template when there is art, else the brief's vector template; back cover gets the blurb, "What's inside" and page thumbnails.
  project = await step("cover", async () => {
    let templateId = art?.layout ?? (chosenTemplate && !isArtTemplate(chosenTemplate) ? chosenTemplate : brief.coverTemplate);
    let pal = art?.palette ?? palette;
    let choice: VariantChoice | null = null;
    // A template or palette the publisher picked is kept as it is; otherwise try the genre's designs and keep the best.
    if (!input.style?.templateId && !input.style?.paletteId) {
      // Art covers also try a palette taken from the chosen art.
      const chosenArt = project.coverArt?.candidates.find((c) => c.id === project.coverArt?.chosenId);
      const fromArt = art && chosenArt ? await paletteFromArt(chosenArt.dataUrl).catch(() => null) : null;
      choice = await chooseVariant(project, { templateId, palette: pal }, fromArt ? [fromArt] : [], signal);
      if (choice.run) runs.push(choice.run);
      templateId = choice.winner.templateId;
      pal = choice.winner.palette;
    }
    let next = await designCover(project, { templateId, palette: pal, backText: listing.output.backCoverBlurb, inside: true, thumbs: true, listingRunId: listing.runId });
    if (choice) {
      const variants = storedVariants(choice);
      next = produce(next, (d) => {
        d.cover.variants = variants;
      });
    }
    const score = next.cover.analysis ? `, score ${Math.round(next.cover.analysis.score)}/100` : "";
    return [next, `${templateId} template, ${pal.name} palette${score}${choice ? ` (best of ${choice.ranked.length}: ${choice.reason})` : ""}`];
  });
  onPreview?.(project, "cover");

  // 6c. Look at the rendered cover and sample pages (needs a vision-capable model).
  project = await step("review", async () => {
    if (briefRes.meta.provider === "offline") return [project, "Offline: rule-based design checks only"];
    try {
      const first = await reviewVisuals(project, signal);
      if (first.run) runs.push(first.run);
      let review = first.review;
      let current = project;
      let redesign = "";
      // A cover the reviewer says doesn't work gets one redesign; the better-reviewed version stays.
      const coverFails = review.score < REDESIGN_BELOW || !review.thumbnailReadable || review.findings.some((f) => f.severity === "high" && /cover/i.test(f.target));
      const target = coverFails ? redesignTarget(project) : null;
      if (target) {
        const firstScore = review.score;
        const before = `${project.cover.templateId}/${project.cover.palette?.name ?? project.cover.paletteId}`;
        const alt = await designCover(project, { ...coverSettings(project), templateId: target.templateId, palette: target.palette, listingRunId: listing.runId });
        const second = await reviewVisuals(alt, signal);
        if (second.run) runs.push(second.run);
        const better = second.review.score > review.score || (!review.thumbnailReadable && second.review.thumbnailReadable && second.review.score >= review.score);
        if (better) {
          current = alt;
          review = second.review;
          redesign = `, redesigned after review: ${before} → ${target.templateId}/${target.palette.name}`;
          notes.push(`The first cover scored ${firstScore}/10 in the visual review, so it was redesigned (${before} → ${target.templateId}/${target.palette.name}).`);
        } else redesign = ", a redesign was tried and the original kept";
      }
      const next = produce(current, (d) => {
        d.reviews = { ...d.reviews, visual: review };
      });
      const serious = review.findings.filter((f) => f.severity !== "low").length;
      return [next, `score ${review.score}/10${serious ? `, ${serious} finding(s) to look at` : ""}${review.thumbnailReadable ? "" : ", title hard to read as a thumbnail"}${redesign}`];
    } catch (e) {
      notes.push(`Visual review skipped: ${e instanceof Error ? e.message : e}`);
      return [project, "skipped"];
    }
  });

  // 7. Preflight + repair loop
  const repairs: string[] = [];
  await step("preflight", async () => {
    let rep = runPreflight(project);
    for (let round = 0; round < 3; round++) {
      const fixes = rep.checks.filter((c) => c.fix && AUTO_FIXES.includes(c.fix.id) && (c.status === "fail" || c.status === "warn"));
      if (!fixes.length) break;
      for (const c of fixes) {
        project = applyFix(project, c.fix!.id);
        repairs.push(`${c.title}: ${c.fix!.label}`);
      }
      rep = runPreflight(project);
    }
    return [rep, `${rep.passed}/${rep.total} passed${repairs.length ? `, ${repairs.length} auto-repair(s)` : ""}`];
  });

  // 8. Provenance
  project = await step("provenance", async () => {
    const next = produce(project, (d) => {
      d.modelRuns.push(...runs);
    });
    const final = applyFix(next, "suggest-ai-disclosure");
    return [final, runs.length ? `${runs.length} model run(s) recorded; disclosure needs your confirmation` : "No model output used (offline heuristics)"];
  });

  onPreview?.(project, "done");
  return { project, report: runPreflight(project), repairs, notes, quality: qualityReport(project) };
}
