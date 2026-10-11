import type { TaskInput } from "@/lib/ai/tasks";
import type { GeneratorConfig } from "@/lib/generators/pages";
import { cleanPhrases, cleanPrompts, cleanWordList, repeatedPuzzles, type WordListOptions } from "@/lib/quality/content";
import type { ContentNeed, PlannedSection } from "./blueprint";

/**
 * Content for planned sections: putting model output into a section's config,
 * then checking the whole book for repeats and weak items and asking for
 * replacements. Pure apart from the `ask` callback, so tests can drive it with
 * the offline heuristics.
 */

type Puzzle = { title: string; words: string[] };

/** Put model-written content into a planned section's config. */
export function applyContent(cfg: GeneratorConfig, need: ContentNeed, output: unknown, runId: string | undefined): GeneratorConfig {
  if (need.task === "journal-prompts" && cfg.kind === "journal-prompts") {
    const prompts = (output as { prompts: string[] }).prompts.map((p) => p.trim()).filter(Boolean);
    return { ...cfg, prompts: [...new Set(prompts)].slice(0, need.count), aiRunId: runId };
  }
  if (need.task === "word-lists" && (cfg.kind === "word-search" || cfg.kind === "word-scramble")) {
    const puzzles = (output as { puzzles: Puzzle[] }).puzzles.filter((p) => p.words.length).slice(0, need.count);
    return { ...cfg, puzzles, aiRunId: runId };
  }
  if (need.task === "phrases") {
    const phrases = [...new Set((output as { phrases: string[] }).phrases.map((p) => p.trim()).filter(Boolean))].slice(0, need.count);
    if (cfg.kind === "cryptogram") return { ...cfg, phrases, aiRunId: runId };
    if (cfg.kind === "gratitude") return { ...cfg, affirmations: phrases, aiRunId: runId };
  }
  return cfg;
}

/** How many content items (prompts, puzzles, sayings, affirmations) a config holds. */
export function contentCount(cfg: GeneratorConfig): number {
  switch (cfg.kind) {
    case "journal-prompts":
      return cfg.prompts.length;
    case "word-search":
    case "word-scramble":
      return cfg.puzzles.length;
    case "cryptogram":
      return cfg.phrases.length;
    case "gratitude":
      return cfg.affirmations?.length ?? 0;
    default:
      return 0;
  }
}

/** A request for more content: `count` new items that avoid everything in `avoid`. */
export interface ContentRequest {
  need: ContentNeed;
  sectionTitle: string;
  count: number;
  avoid: string[];
  /** The publisher's feedback on the version being replaced (Regenerate with feedback). */
  feedback?: string;
}

type ContentTask = "journal-prompts" | "word-lists" | "phrases";

/** The AI task, its input and the provenance outputs for a content request. */
export function contentCall(req: ContentRequest, ctx: { audience: string; bookTitle: string }): { task: ContentTask; input: TaskInput<ContentTask>; outputs: string[] } {
  const { need, sectionTitle, count } = req;
  const topic = need.theme;
  const avoid = req.avoid.length ? req.avoid : undefined;
  const feedback = req.feedback?.trim() || undefined;
  const { audience, bookTitle } = ctx;
  if (need.task === "journal-prompts") return { task: need.task, input: { topic, audience, count, bookTitle, sectionTitle, avoid, feedback }, outputs: [`interior.prompts:${sectionTitle}`] };
  if (need.task === "word-lists")
    return { task: need.task, input: { topic, audience, count, wordsPerPuzzle: need.wordsPerPuzzle, maxLength: need.maxLength, difficulty: need.difficulty, avoid, feedback }, outputs: [`interior.word-lists:${sectionTitle}`] };
  return { task: need.task, input: { topic, audience, count, maxLength: need.maxLength, style: need.style, bookTitle, avoid, feedback }, outputs: [`interior.phrases:${sectionTitle}`] };
}

export type ContentAsk = (req: ContentRequest) => Promise<{ output: unknown; runId?: string }>;

const wordOptions = (cfg: GeneratorConfig, need: ContentNeed): WordListOptions => ({
  maxLength: need.task === "word-lists" ? need.maxLength : 12,
  scramble: cfg.kind === "word-scramble",
});
const minWords = (need: ContentNeed) => (need.task === "word-lists" ? Math.max(6, Math.floor(need.wordsPerPuzzle * 0.6)) : 6);

/** Book-wide memory of what is already used, so sections don't repeat each other. */
interface Seen {
  prompt: string[];
  saying: string[];
  affirmation: string[];
  puzzles: Puzzle[];
}

/**
 * Keep the usable, non-repeated items of `items`, at most `room` of them, and
 * record them in `seen`. Returns the kept items and how many were dropped.
 */
function keep(cfg: GeneratorConfig, need: ContentNeed, items: unknown[], room: number, seen: Seen): { kept: unknown[]; dropped: number } {
  if (cfg.kind === "journal-prompts") {
    const r = cleanPrompts(items as string[], seen.prompt);
    const kept = r.kept.slice(0, room);
    seen.prompt.push(...kept);
    return { kept, dropped: r.dropped.length };
  }
  if (cfg.kind === "cryptogram" || cfg.kind === "gratitude") {
    const style = cfg.kind === "cryptogram" ? "saying" : "affirmation";
    const maxLength = need.task === "phrases" ? need.maxLength : 120;
    const r = cleanPhrases(items as string[], style, maxLength, seen[style]);
    const kept = r.kept.slice(0, room);
    seen[style].push(...kept);
    return { kept, dropped: r.dropped.length };
  }
  if (cfg.kind === "word-search" || cfg.kind === "word-scramble") {
    const o = wordOptions(cfg, need);
    const cleaned = (items as Puzzle[]).map((p) => ({ title: p.title.trim() || "Puzzle", words: cleanWordList(p.words, o).kept }));
    const repeated = new Set(repeatedPuzzles([...seen.puzzles, ...cleaned], []).map((r) => r.index - seen.puzzles.length));
    const kept: Puzzle[] = [];
    let dropped = 0;
    cleaned.forEach((p, i) => {
      if (kept.length >= room || repeated.has(i) || p.words.length < minWords(need)) {
        dropped++;
        return;
      }
      kept.push(p);
      seen.puzzles.push(p);
    });
    return { kept, dropped };
  }
  return { kept: items, dropped: 0 };
}

function withItems(cfg: GeneratorConfig, items: unknown[]): GeneratorConfig {
  switch (cfg.kind) {
    case "journal-prompts":
      return { ...cfg, prompts: items as string[] };
    case "word-search":
    case "word-scramble":
      return { ...cfg, puzzles: items as Puzzle[] };
    case "cryptogram":
      return { ...cfg, phrases: items as string[] };
    case "gratitude":
      return { ...cfg, affirmations: items as string[] };
    default:
      return cfg;
  }
}

function itemsOf(cfg: GeneratorConfig): unknown[] {
  switch (cfg.kind) {
    case "journal-prompts":
      return cfg.prompts;
    case "word-search":
    case "word-scramble":
      return cfg.puzzles;
    case "cryptogram":
      return cfg.phrases;
    case "gratitude":
      return cfg.affirmations ?? [];
    default:
      return [];
  }
}

function newItems(cfg: GeneratorConfig, output: unknown): unknown[] {
  if (cfg.kind === "journal-prompts") return (output as { prompts?: string[] }).prompts ?? [];
  if (cfg.kind === "word-search" || cfg.kind === "word-scramble") return (output as { puzzles?: Puzzle[] }).puzzles ?? [];
  return (output as { phrases?: string[] }).phrases ?? [];
}

/** What a section's items should not repeat: the book's items of the same kind (most recent first, capped). */
function avoidFor(cfg: GeneratorConfig, seen: Seen): string[] {
  const list =
    cfg.kind === "journal-prompts" ? seen.prompt : cfg.kind === "cryptogram" ? seen.saying : cfg.kind === "gratitude" ? seen.affirmation : seen.puzzles.map((p) => p.title);
  return list.slice(-150);
}

export interface RefineResult {
  sections: PlannedSection[];
  /** Items dropped as repeats or unusable. */
  removed: number;
  /** Replacement items written. */
  added: number;
  notes: string[];
}

/**
 * Check every section's content against the rest of the book, drop repeats
 * and unusable items, and ask for replacements (up to `rounds` times). A
 * section that still comes up short keeps fewer items; its unused pages become
 * notes pages when the book is assembled.
 */
export async function refineContent(sections: PlannedSection[], ask: ContentAsk, rounds = 2): Promise<RefineResult> {
  const seen: Seen = { prompt: [], saying: [], affirmation: [], puzzles: [] };
  let removed = 0;
  let added = 0;
  const out = sections.map((s) => ({ ...s }));

  // Pass 1: clean every section in reading order, so the earlier section keeps a shared item.
  for (const s of out) {
    if (!s.content) continue;
    const r = keep(s.config, s.content, itemsOf(s.config), s.content.count, seen);
    removed += r.dropped;
    s.config = withItems(s.config, r.kept);
  }

  // Top-up rounds: ask for what is missing, then clean the answers in section order.
  for (let round = 0; round < rounds; round++) {
    const short = out.filter((s) => s.content && contentCount(s.config) < s.content.count);
    if (!short.length) break;
    const answers = await Promise.all(
      short.map(async (s) => {
        const missing = s.content!.count - contentCount(s.config);
        // Ask for a little extra: some of the new items may repeat too.
        const count = Math.min(s.content!.count, missing + Math.ceil(missing / 4) + 1);
        try {
          return await ask({ need: s.content!, sectionTitle: s.label, count, avoid: avoidFor(s.config, seen) });
        } catch {
          return null;
        }
      }),
    );
    let progress = 0;
    short.forEach((s, i) => {
      const a = answers[i];
      if (!a) return;
      const room = s.content!.count - contentCount(s.config);
      const r = keep(s.config, s.content!, newItems(s.config, a.output), room, seen);
      added += r.kept.length;
      progress += r.kept.length;
      s.config = withItems(s.config, [...itemsOf(s.config), ...r.kept]);
      if (a.runId && !("aiRunId" in s.config && s.config.aiRunId)) s.config = { ...s.config, aiRunId: a.runId } as GeneratorConfig;
    });
    if (!progress) break;
  }

  const notes: string[] = [];
  if (removed) notes.push(`Content check: removed ${removed} repeated or unusable item(s)${added ? ` and wrote ${added} replacement(s)` : ""}.`);
  for (const s of out) {
    // Gratitude pages cycle through their affirmations, so a short list costs no pages.
    if (!s.content || s.config.kind === "gratitude") continue;
    const n = contentCount(s.config);
    if (n < s.content.count) notes.push(`${s.label}: needed ${s.content.count}, kept ${n} distinct; the rest of its page budget became notes pages.`);
  }
  return { sections: out, removed, added, notes };
}

export interface RewriteResult {
  config: GeneratorConfig;
  /** New items in the section. */
  written: number;
  /** Old items kept because the replacements came up short. */
  kept: number;
  runId?: string;
}

/**
 * Rewrite one section's content with the publisher's feedback, keeping the
 * same number of items so the book's page count holds. New items must not
 * repeat the rest of the book (`others`) or the items they replace; if the
 * model comes up short after two asks, the best of the old items fill the gap.
 */
export async function rewriteSection(cfg: GeneratorConfig, need: ContentNeed, others: GeneratorConfig[], ask: ContentAsk, opts: { sectionTitle: string; feedback: string }): Promise<RewriteResult> {
  const seen: Seen = { prompt: [], saying: [], affirmation: [], puzzles: [] };
  for (const o of others) {
    if (o.kind === "journal-prompts") seen.prompt.push(...o.prompts);
    else if (o.kind === "cryptogram") seen.saying.push(...o.phrases);
    else if (o.kind === "gratitude") seen.affirmation.push(...(o.affirmations ?? []));
    else if (o.kind === "word-search" || o.kind === "word-scramble") seen.puzzles.push(...o.puzzles);
  }
  const old = itemsOf(cfg);
  const oldText = old.map((x) => (typeof x === "string" ? x : (x as Puzzle).title));
  const target = need.count;
  let items: unknown[] = [];
  let runId: string | undefined;
  for (let round = 0; round < 2 && items.length < target; round++) {
    const missing = target - items.length;
    const count = Math.min(target + 4, missing + Math.ceil(missing / 4) + 1);
    const avoid = [...avoidFor(cfg, seen), ...oldText].slice(-200);
    const a = await ask({ need, sectionTitle: opts.sectionTitle, count, avoid, feedback: opts.feedback }).catch(() => null);
    if (!a) break;
    runId ??= a.runId;
    const r = keep(cfg, need, newItems(cfg, a.output), missing, seen);
    if (!r.kept.length) break;
    items = [...items, ...r.kept];
  }
  const written = items.length;
  if (items.length < target) items = [...items, ...keep(cfg, need, old, target - items.length, seen).kept];
  // Puzzle numbering continues into later sections, so a puzzle section keeps its count even if that means an old puzzle that resembles a new one.
  if (items.length < target && cfg.kind !== "journal-prompts" && cfg.kind !== "gratitude") {
    const have = new Set(items.map((x) => JSON.stringify(x)));
    items = [...items, ...old.filter((x) => !have.has(JSON.stringify(x)))].slice(0, target);
  }
  let config = withItems(cfg, items);
  if (runId && written) config = { ...config, aiRunId: runId } as GeneratorConfig;
  return { config, written, kept: items.length - written, runId };
}
