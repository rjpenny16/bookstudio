import { produce } from "immer";
import { estimatePageCount, generatePages, type GeneratorConfig } from "@/lib/generators/pages";
import { randomSeed } from "@/lib/generators/rng";
import { CRYPTOGRAM_MAX, sectionTexts, wordSearchMaxLength } from "@/lib/quality/content";
import type { InteriorSection, Project } from "@/lib/schema/project";
import type { ContentNeed } from "./blueprint";
import { contentCount, rewriteSection, type ContentAsk } from "./content";

/**
 * "Regenerate with feedback" for one interior section. Content sections
 * (prompts, word lists, sayings, affirmations) are rewritten by the model
 * with the feedback; puzzle sections get new puzzles, harder or easier when
 * the feedback says so. The section's answer key follows it, and the rest of
 * the book is left alone. Pure apart from `ask`, so tests run it offline.
 */

const PUZZLE_KINDS = new Set(["sudoku", "word-search", "number-search", "maze", "word-scramble", "cryptogram"]);
const isPuzzle = (cfg: GeneratorConfig) => PUZZLE_KINDS.has(cfg.kind);

/** Sections worth a Regenerate box: body sections with written content or puzzles (not answer keys). */
export function canRegenerate(section: InteriorSection): boolean {
  const c = section.config;
  if ("part" in c && c.part === "solutions") return false;
  return isPuzzle(c) || sectionTexts(c) !== null;
}

/** The content a section's config holds, as a request for the same amount. */
export function needForSection(cfg: GeneratorConfig, theme: string): ContentNeed | null {
  switch (cfg.kind) {
    case "journal-prompts":
      return { task: "journal-prompts", theme, count: Math.max(1, cfg.prompts.length) };
    case "word-search":
      return { task: "word-lists", theme, count: Math.max(1, cfg.puzzles.length), wordsPerPuzzle: cfg.size <= 12 ? 10 : cfg.size <= 15 ? 15 : 18, maxLength: wordSearchMaxLength(cfg.size), difficulty: cfg.difficulty };
    case "word-scramble":
      return { task: "word-lists", theme, count: Math.max(1, cfg.puzzles.length), wordsPerPuzzle: 15, maxLength: 10 };
    case "cryptogram":
      return { task: "phrases", theme, count: Math.max(1, cfg.phrases.length), maxLength: CRYPTOGRAM_MAX(cfg.perPage), style: "saying" };
    case "gratitude":
      return { task: "phrases", theme, count: Math.max(1, cfg.affirmations?.length || Math.min(cfg.count, 60)), maxLength: 90, style: "affirmation" };
    default:
      return null;
  }
}

const HARDER = /\b(harder|more difficult|tougher|more challenging|challenge|too easy)\b/i;
const EASIER = /\b(easier|simpler|gentler|less difficult|too hard|too difficult)\b/i;

/** "harder puzzles" / "easier please": one difficulty step, where the kind has one. */
export function shiftDifficulty(cfg: GeneratorConfig, feedback: string): GeneratorConfig {
  const dir = HARDER.test(feedback) ? 1 : EASIER.test(feedback) ? -1 : 0;
  if (!dir || !("difficulty" in cfg)) return cfg;
  const levels = cfg.kind === "sudoku" ? ["easy", "medium", "hard", "expert"] : ["easy", "medium", "hard"];
  const i = Math.max(0, Math.min(levels.length - 1, levels.indexOf(cfg.difficulty ?? "medium") + dir));
  return { ...cfg, difficulty: levels[i] } as GeneratorConfig;
}

/** Answer-key sections generated from the same puzzles as `sec`. */
function answerSections(project: Project, sec: InteriorSection): InteriorSection[] {
  const c = sec.config;
  if (!("seed" in c)) return [];
  return project.interior.sections.filter((s) => s.id !== sec.id && s.config.kind === c.kind && "seed" in s.config && s.config.seed === c.seed && s.config.part === "solutions");
}

/** Replace the pages of the given sections, keeping everything else, and move contents entries after a section that changed length. */
export function replaceSections(project: Project, configs: Map<string, GeneratorConfig>): Project {
  return produce(project, (d) => {
    const hint = d.interior.pages.length;
    for (const [id, config] of configs) {
      const s = d.interior.sections.find((x) => x.id === id);
      if (!s) continue;
      const first = d.interior.pages.findIndex((p) => p.sectionId === id);
      const count = d.interior.pages.filter((p) => p.sectionId === id).length;
      const pages = generatePages(config, { spec: d.spec, pageCountHint: hint }).map((p) => ({ ...p, sectionId: id }));
      s.config = config as typeof s.config;
      d.interior.pages.splice(first < 0 ? d.interior.pages.length : first, count, ...pages);
      const delta = pages.length - count;
      if (!delta || first < 0) continue;
      // Contents page numbers are 1-based page positions.
      const toc = d.interior.sections.find((x) => x.config.kind === "table-of-contents");
      if (toc?.config.kind !== "table-of-contents") continue;
      toc.config.entries = toc.config.entries.map((e) => (e.page > first + 1 ? { ...e, page: e.page + delta } : e));
      const at = d.interior.pages.findIndex((p) => p.sectionId === toc.id);
      d.interior.pages.splice(at, 1, ...generatePages(toc.config, { spec: d.spec, pageCountHint: hint }).map((p) => ({ ...p, sectionId: toc.id })));
    }
  });
}

export interface RegenerateResult {
  project: Project;
  summary: string;
}

export async function regenerateSection(project: Project, sectionId: string, feedback: string, ask: ContentAsk): Promise<RegenerateResult> {
  const sec = project.interior.sections.find((s) => s.id === sectionId);
  if (!sec || !canRegenerate(sec)) throw new Error("This section can't be regenerated.");
  const keys = answerSections(project, sec);
  let cfg = shiftDifficulty(sec.config, feedback);
  const harder = "difficulty" in cfg && "difficulty" in sec.config && cfg.difficulty !== sec.config.difficulty ? ` Difficulty: ${sec.config.difficulty} → ${cfg.difficulty}.` : "";
  if ("seed" in cfg) cfg = { ...cfg, seed: randomSeed() } as GeneratorConfig;

  let summary: string;
  const theme = `${project.brief.topic || project.metadata.title || project.name}: ${sec.label}`;
  const need = needForSection(cfg, theme);
  if (need) {
    if (need.task === "word-lists" && "difficulty" in cfg && cfg.kind === "word-search") need.difficulty = cfg.difficulty;
    const skip = new Set([sec.id, ...keys.map((k) => k.id)]);
    const others = project.interior.sections.filter((s) => !skip.has(s.id) && !("part" in s.config && s.config.part === "solutions")).map((s) => s.config);
    const r = await rewriteSection(cfg, need, others, ask, { sectionTitle: sec.label, feedback });
    cfg = r.config;
    summary = r.written ? `Rewrote ${r.written} of ${contentCount(cfg)} item(s)${r.kept ? `; kept ${r.kept} earlier one(s) to fill the section` : ""}.` : `No usable new content came back, so the section kept its items${isPuzzle(cfg) ? " (in new puzzle layouts)" : ""}.`;
  } else {
    summary = `New ${estimatePageCount(cfg) ? "puzzles" : "pages"} generated.`;
  }

  const configs = new Map<string, GeneratorConfig>([[sec.id, cfg]]);
  for (const k of keys) configs.set(k.id, { ...cfg, part: "solutions" } as GeneratorConfig);
  const next = replaceSections(project, configs);
  const delta = next.interior.pages.length - project.interior.pages.length;
  return { project: next, summary: `${summary}${harder}${delta ? ` The book is now ${next.interior.pages.length} pages.` : ""}` };
}
