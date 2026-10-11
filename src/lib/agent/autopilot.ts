import { produce } from "immer";
import { callAi, isModelOutput, modelRun, type AiCallResult } from "@/lib/ai/client";
import type { BriefOutput, TaskName } from "@/lib/ai/tasks";
import { buildCover, PALETTES } from "@/lib/cover/templates";
import { coverGeometry, findTrim } from "@/lib/kdp/geometry";
import type { GeneratorConfig } from "@/lib/generators/pages";
import { randomSeed } from "@/lib/generators/rng";
import { cleanKeywords, findProhibited } from "@/lib/metadata/validate";
import { runPreflight, type FixId, type PreflightReport } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { createProject } from "@/lib/schema/factory";
import { isLowContent, type BookType, type ModelRun, type Project } from "@/lib/schema/project";

/**
 * The publishing agent. It is a deterministic workflow with model calls inside
 * it: the model proposes (brief, copy, prompts, word lists) and validated domain
 * operations build the book. It stops at a human approval gate; it never
 * publishes to KDP.
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
  { id: "content", label: "Generate interior content" },
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
}

const AUTO_FIXES: FixId[] = ["pad-min", "pad-even", "move-into-safe", "remove-spine-text", "clear-barcode", "clean-keywords", "suggest-ai-disclosure"];

function clampPages(n: number) {
  return Math.max(24, Math.min(300, Math.round(n)));
}

export async function runAutopilot(
  input: AutopilotInput,
  onStep: (id: string, status: StepStatus, detail?: string) => void,
  signal?: AbortSignal,
): Promise<AutopilotResult> {
  const runs: ModelRun[] = [];
  const ai = async <T extends TaskName>(task: T, payload: Parameters<typeof callAi<T>>[1], outputs: string[]): Promise<AiCallResult<T>> => {
    const res = await callAi(task, payload, signal);
    if (isModelOutput(res.meta)) runs.push(modelRun(res.meta, outputs));
    return res;
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

  // 1. Brief
  const briefRes = await step("brief", async () => {
    const r = await ai("brief", { topic: input.topic, audience: input.audience, bookType: input.bookType, notes: input.notes, trim: trim.label }, ["brief"]);
    return [r, `${r.output.titleIdeas[0] ?? input.topic} · ${r.output.generator} · ${r.meta.provider}`];
  });
  const brief: BriefOutput = briefRes.output;
  const aiText = isModelOutput(briefRes.meta);
  const pageTarget = clampPages(brief.pageTarget || 120);

  // 2. Content
  const config = await step("content", async (): Promise<[GeneratorConfig, string]> => {
    const body = pageTarget - 4;
    const difficulty = brief.difficulty;
    switch (brief.generator) {
      case "journal-prompts": {
        const count = Math.min(200, body);
        const r = await ai("journal-prompts", { topic: input.topic, audience: brief.audience, count }, ["interior.prompts"]);
        const prompts = r.output.prompts.filter((p) => p.trim()).slice(0, count);
        return [{ kind: "journal-prompts", prompts, spacingIn: 0.3125, aiRunId: isModelOutput(r.meta) ? runs[runs.length - 1]?.id : undefined }, `${prompts.length} prompts`];
      }
      case "word-search": {
        const count = Math.min(80, Math.max(10, Math.round(body / 1.25)));
        const size = difficulty === "easy" ? 12 : difficulty === "medium" ? 15 : 18;
        const r = await ai("word-lists", { topic: input.topic, audience: brief.audience, count, wordsPerPuzzle: difficulty === "easy" ? 10 : 15, maxLength: size - 2 }, ["interior.word-lists"]);
        return [{ kind: "word-search", puzzles: r.output.puzzles.slice(0, count), size, difficulty, solutions: true, seed: randomSeed(), aiRunId: isModelOutput(r.meta) ? runs[runs.length - 1]?.id : undefined }, `${r.output.puzzles.length} themed puzzles`];
      }
      case "sudoku": {
        const count = Math.max(10, Math.round((body * 1.5) / 2) * 2);
        return [{ kind: "sudoku", count, difficulty: difficulty === "hard" ? "hard" : difficulty, perPage: 2, solutions: true, seed: randomSeed() }, `${count} ${difficulty} sudoku`];
      }
      case "maze": {
        const count = Math.max(10, Math.round(body / 1.25));
        return [{ kind: "maze", count, difficulty, solutions: true, seed: randomSeed() }, `${count} ${difficulty} mazes`];
      }
      case "gratitude":
        return [{ kind: "gratitude", count: body }, `${body} gratitude pages`];
      case "daily-planner":
        return [{ kind: "daily-planner", count: body }, `${body} planner pages`];
      case "habit-tracker":
        return [{ kind: "habit-tracker", count: Math.min(body, 24), habits: 15 }, "habit tracker pages"];
      case "log":
        return [{ kind: "log", count: body, title: `${input.topic} Log`.slice(0, 40), columns: ["Date", "Details", "Notes"], rows: 22 }, `${body} log pages`];
      case "dot-grid":
        return [{ kind: "dot-grid", count: body, spacingIn: 0.25 }, `${body} dot grid pages`];
      case "graph":
        return [{ kind: "graph", count: body, spacingIn: 0.25, majorEvery: 4 }, `${body} graph pages`];
      case "handwriting":
        return [{ kind: "handwriting", count: body, rowHeightIn: 0.75 }, `${body} handwriting pages`];
      default:
        return [{ kind: "lined", count: body, spacingIn: 0.3125, header: true }, `${body} lined pages`];
    }
  });

  // 3. Layout
  const title = brief.titleIdeas.find((t) => !findProhibited(t).length) ?? input.topic;
  let project = await step("layout", async () => {
    const front: GeneratorConfig[] = [{ kind: "title-page", title, subtitle: brief.subtitle, author: input.author }];
    if (isLowContent(input.bookType)) front.push({ kind: "belongs-to" });
    const p = createProject({ name: title, bookType: input.bookType, trimId: trim.id, paper: "white", ink: "black", bleed: false, author: input.author, interior: [...front, config] });
    return [p, `${p.interior.pages.length} pages`];
  });
  project = produce(project, (d) => {
    d.brief = { topic: input.topic, audience: brief.audience, notes: input.notes, angle: brief.angle, titleIdeas: brief.titleIdeas, keywordIdeas: brief.keywordIdeas, interiorPlan: brief.interiorPlan, coverDirection: brief.coverDirection, risks: brief.risks };
  });

  // 4. Listing
  const listing = await step("listing", async () => {
    const r = await ai(
      "listing",
      {
        topic: input.topic,
        audience: brief.audience,
        bookType: input.bookType,
        angle: brief.angle,
        workingTitle: title,
        author: input.author,
        interiorSummary: brief.interiorPlan,
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

  // 5. Cover
  project = await step("cover", async () => {
    const palette = PALETTES.find((p) => p.id === brief.palette) ?? PALETTES[0];
    const cg = coverGeometry(project.spec, project.interior.pages.length);
    const cover = buildCover(brief.coverTemplate, { title: project.metadata.title, subtitle: project.metadata.subtitle, author: input.author, backText: listing.output.backCoverBlurb, palette }, cg);
    const next = produce(project, (d) => {
      d.cover.background = cover.background;
      d.cover.templateId = cover.templateId;
      d.cover.elements = cover.elements.map((el) =>
        aiText && el.type === "text" && (el.name === "Back blurb" || el.name === "Subtitle") ? { ...el, provenance: { origin: "ai-generated" as const, runId: runs[runs.length - 1]?.id } } : el,
      );
    });
    return [next, `${brief.coverTemplate} template, ${palette.name} palette`];
  });

  // 6. Preflight + repair loop
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

  // 7. Provenance
  project = await step("provenance", async () => {
    const next = produce(project, (d) => {
      d.modelRuns.push(...runs);
    });
    const final = applyFix(next, "suggest-ai-disclosure");
    return [final, runs.length ? `${runs.length} model run(s) recorded; disclosure needs your confirmation` : "No model output used (offline heuristics)"];
  });

  return { project, report: runPreflight(project), repairs };
}
