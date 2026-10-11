import { produce } from "immer";
import { callAi, isModelOutput, modelRun, type AiCallResult } from "@/lib/ai/client";
import type { BlueprintOutput, BriefOutput, TaskName } from "@/lib/ai/tasks";
import { buildCover, PALETTES } from "@/lib/cover/templates";
import { coverGeometry, findTrim } from "@/lib/kdp/geometry";
import type { GeneratorConfig } from "@/lib/generators/pages";
import { cleanKeywords, findProhibited } from "@/lib/metadata/validate";
import { runPreflight, type FixId, type PreflightReport } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { createProject } from "@/lib/schema/factory";
import type { BookType, ModelRun, Project } from "@/lib/schema/project";
import { assembleBook, clampPageTarget, describeBook, planSections, validateBlueprint, type ContentNeed, type PlannedSection } from "./blueprint";

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
}

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
  { id: "layout", label: "Lay out interior pages" },
  { id: "listing", label: "Write listing metadata" },
  { id: "cover", label: "Design cover" },
  { id: "preflight", label: "Run KDP preflight & auto-repair" },
  { id: "provenance", label: "Record provenance & disclosure" },
];

export interface AutopilotResult {
  project: Project;
  report: PreflightReport;
  repairs: string[];
  /** Notes worth showing the user (fallbacks, sections that came back short). */
  notes: string[];
}

const AUTO_FIXES: FixId[] = ["pad-min", "pad-even", "move-into-safe", "remove-spine-text", "clear-barcode", "clean-keywords", "suggest-ai-disclosure"];

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

/** Put model-written content into a planned section's config. */
function applyContent(cfg: GeneratorConfig, need: ContentNeed, output: unknown, runId: string | undefined): GeneratorConfig {
  if (need.task === "journal-prompts" && cfg.kind === "journal-prompts") {
    const prompts = (output as { prompts: string[] }).prompts.map((p) => p.trim()).filter(Boolean);
    return { ...cfg, prompts: [...new Set(prompts)].slice(0, need.count), aiRunId: runId };
  }
  if (need.task === "word-lists" && (cfg.kind === "word-search" || cfg.kind === "word-scramble")) {
    const puzzles = (output as { puzzles: { title: string; words: string[] }[] }).puzzles.filter((p) => p.words.length).slice(0, need.count);
    return { ...cfg, puzzles, aiRunId: runId };
  }
  if (need.task === "phrases") {
    const phrases = [...new Set((output as { phrases: string[] }).phrases.map((p) => p.trim()).filter(Boolean))].slice(0, need.count);
    if (cfg.kind === "cryptogram") return { ...cfg, phrases, aiRunId: runId };
    if (cfg.kind === "gratitude") return { ...cfg, affirmations: phrases, aiRunId: runId };
  }
  return cfg;
}

export async function runAutopilot(
  input: AutopilotInput,
  onStep: (id: string, status: StepStatus, detail?: string) => void,
  signal?: AbortSignal,
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
  const pageTarget = clampPageTarget(brief.pageTarget || 120);
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
  const filled: PlannedSection[] = await step("content", async () => {
    const out = await pool(planned, 3, async (sec): Promise<PlannedSection> => {
      const need = sec.content;
      if (!need) return sec;
      const topic = need.theme;
      const r =
        need.task === "journal-prompts"
          ? await ai("journal-prompts", { topic, audience, count: need.count }, [`interior.prompts:${sec.label}`])
          : need.task === "word-lists"
            ? await ai("word-lists", { topic, audience, count: need.count, wordsPerPuzzle: need.wordsPerPuzzle, maxLength: need.maxLength }, [`interior.word-lists:${sec.label}`])
            : await ai("phrases", { topic, audience, count: need.count, maxLength: need.maxLength, style: need.style }, [`interior.phrases:${sec.label}`]);
      return { ...sec, config: applyContent(sec.config, need, r.output, r.runId) };
    });
    for (let i = 0; i < out.length; i++) {
      const need = planned[i].content;
      if (!need) continue;
      const got = out[i].config;
      const n = got.kind === "journal-prompts" ? got.prompts.length : got.kind === "word-search" || got.kind === "word-scramble" ? got.puzzles.length : got.kind === "cryptogram" ? got.phrases.length : need.count;
      if (n < need.count) notes.push(`${planned[i].label}: asked for ${need.count}, received ${n}; the rest of the page budget became notes pages.`);
    }
    return [out, describeBook(out)];
  });

  // 4. Layout
  let project = await step("layout", async () => {
    const sections = assembleBook(blueprint, filled, { ...ctx, audience, trimId: trim.id, pageTarget, title, subtitle: brief.subtitle, author: input.author, blueprintRunId });
    const p = createProject({ name: title, bookType: input.bookType, trimId: trim.id, paper: "white", ink: "black", bleed: false, author: input.author, interior: sections });
    return [p, `${p.interior.pages.length} pages in ${p.interior.sections.length} parts`];
  });
  const interiorSummary = describeBook(filled);
  project = produce(project, (d) => {
    d.brief = { topic: input.topic, audience, notes: input.notes, angle: brief.angle, titleIdeas: brief.titleIdeas, keywordIdeas: brief.keywordIdeas, interiorPlan: interiorSummary, coverDirection: brief.coverDirection, risks: brief.risks };
  });

  // 5. Listing
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
    d.metadata.categories = L.categories.slice(0, 3);
    if (L.suggestedPriceUsd > 0) d.metadata.listPriceUsd = Math.round(L.suggestedPriceUsd * 100) / 100;
    d.name = d.metadata.title;
  });

  // 6. Cover
  project = await step("cover", async () => {
    const palette = PALETTES.find((p) => p.id === brief.palette) ?? PALETTES[0];
    const cg = coverGeometry(project.spec, project.interior.pages.length);
    const cover = buildCover(brief.coverTemplate, { title: project.metadata.title, subtitle: project.metadata.subtitle, author: input.author, backText: listing.output.backCoverBlurb, palette }, cg);
    const next = produce(project, (d) => {
      d.cover.background = cover.background;
      d.cover.templateId = cover.templateId;
      d.cover.elements = cover.elements.map((el) =>
        listing.runId && el.type === "text" && (el.name === "Back blurb" || el.name === "Subtitle") ? { ...el, provenance: { origin: "ai-generated" as const, runId: listing.runId } } : el,
      );
    });
    return [next, `${brief.coverTemplate} template, ${palette.name} palette`];
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

  return { project, report: runPreflight(project), repairs, notes };
}
