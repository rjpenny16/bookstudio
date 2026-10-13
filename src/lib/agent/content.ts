import { DEFAULT_LIMITS, type ContentTask, type ProviderLimits } from "@/lib/ai/limits";
import type { TaskInput } from "@/lib/ai/tasks";
import type { GeneratorConfig } from "@/lib/generators/pages";
import { cleanCrossword, cleanPhrases, cleanPrompts, cleanWordList, type CrosswordEntry, openerKey, phraseProblems, promptProblems, repeatedPuzzles, type WordListOptions } from "@/lib/quality/content";
import type { ContentNeed, PlannedSection } from "./blueprint";

/**
 * Content for planned sections: putting model output into a section's config,
 * then checking the whole book for repeats and weak items and asking for
 * replacements. Pure apart from the `ask` callback, so tests can drive it with
 * the offline heuristics.
 */

type Puzzle = { title: string; words: string[] };
type CrosswordPuzzle = { title: string; entries: CrosswordEntry[] };
/** A crossword as a word list, for the book-wide repeat checks. */
const asWords = (p: CrosswordPuzzle): Puzzle => ({ title: p.title, words: p.entries.map((e) => e.answer) });

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
  if (need.task === "crossword-clues" && cfg.kind === "crossword") {
    const puzzles = (output as { puzzles: CrosswordPuzzle[] }).puzzles.filter((p) => p.entries.length).slice(0, need.count);
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
    case "crossword":
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
  if (need.task === "crossword-clues")
    return { task: need.task, input: { topic, audience, count, entriesPerPuzzle: need.entriesPerPuzzle, maxLength: need.maxLength, difficulty: need.difficulty, avoid, feedback }, outputs: [`interior.crossword-clues:${sectionTitle}`] };
  return { task: need.task, input: { topic, audience, count, maxLength: need.maxLength, style: need.style, bookTitle, avoid, feedback }, outputs: [`interior.phrases:${sectionTitle}`] };
}

export type ContentAsk = (req: ContentRequest) => Promise<{ output: unknown; runId?: string }>;
type Answer = Awaited<ReturnType<ContentAsk>>;

/** Failures no retry fixes: not logged in, usage limit, provider missing, cancelled. They stop the run with their own message. */
const FATAL_STATUS = new Set([401, 403, 429, 499, 503]);
const statusOf = (e: unknown) => (typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : undefined);
export const isFatal = (e: unknown) => (e instanceof Error && e.name === "AbortError") || FATAL_STATUS.has(statusOf(e) ?? 0);
/** A bad request won't go better with fewer items; a timeout or malformed reply may. */
const retryable = (e: unknown) => statusOf(e) !== 400;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 160);

/**
 * Ask for content without letting one bad call sink a section silently. A
 * fatal failure is thrown; a timeout or malformed reply is retried once with
 * half the items (smaller asks finish sooner and fit the schema more often);
 * anything still failing is noted in `problems` and answered with null.
 */
async function askSafely(ask: ContentAsk, req: ContentRequest, problems: string[]): Promise<Answer | null> {
  let err: unknown;
  try {
    return await ask(req);
  } catch (e) {
    if (isFatal(e)) throw e;
    err = e;
  }
  if (req.count > 1 && retryable(err)) {
    try {
      return await ask({ ...req, count: Math.ceil(req.count / 2) });
    } catch (e) {
      if (isFatal(e)) throw e;
      err = e;
    }
  }
  problems.push(`${req.sectionTitle}: a writing call failed (${why(err)})`);
  return null;
}

/** A model review that fails is skipped (the rule checks still run), unless the failure is fatal. */
async function softly<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (isFatal(e)) throw e;
    return null;
  }
}

/** Run async jobs with limited parallelism, keeping result order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const wordOptions = (cfg: GeneratorConfig, need: ContentNeed): WordListOptions => ({
  maxLength: need.task === "word-lists" ? need.maxLength : 12,
  scramble: cfg.kind === "word-scramble",
});
const minWords = (need: ContentNeed) => (need.task === "word-lists" ? Math.max(6, Math.floor(need.wordsPerPuzzle * 0.6)) : need.task === "crossword-clues" ? Math.max(6, Math.floor(need.entriesPerPuzzle * 0.6)) : 6);

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
  if (cfg.kind === "crossword") {
    const maxLength = need.task === "crossword-clues" ? need.maxLength : cfg.size;
    const cleaned = (items as CrosswordPuzzle[]).map((p) => ({ title: (p.title ?? "").trim() || "Crossword", entries: cleanCrossword(p.entries ?? [], maxLength).kept }));
    const repeated = new Set(repeatedPuzzles([...seen.puzzles, ...cleaned.map(asWords)], []).map((r) => r.index - seen.puzzles.length));
    const kept: CrosswordPuzzle[] = [];
    let dropped = 0;
    cleaned.forEach((p, i) => {
      if (kept.length >= room || repeated.has(i) || p.entries.length < minWords(need)) {
        dropped++;
        return;
      }
      kept.push(p);
      seen.puzzles.push(asWords(p));
    });
    return { kept, dropped };
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
    case "crossword":
      return { ...cfg, puzzles: items as CrosswordPuzzle[] };
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
    case "crossword":
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
  if (cfg.kind === "crossword") return (output as { puzzles?: CrosswordPuzzle[] }).puzzles ?? [];
  return (output as { phrases?: string[] }).phrases ?? [];
}

/** What a section's items should not repeat: the book's items of the same kind (most recent first, capped). */
function avoidFor(cfg: GeneratorConfig, seen: Seen, max = DEFAULT_LIMITS.avoid): string[] {
  const list =
    cfg.kind === "journal-prompts" ? seen.prompt : cfg.kind === "cryptogram" ? seen.saying : cfg.kind === "gratitude" ? seen.affirmation : seen.puzzles.map((p) => p.title);
  return list.slice(-max);
}

/** Items asked for per model call by default (see DEFAULT_LIMITS). */
export const BATCH_SIZE = DEFAULT_LIMITS.batch["journal-prompts"];

export interface WriteResult {
  config: GeneratorConfig;
  /** Model calls made. */
  batches: number;
  runId?: string;
  /** Calls that failed after a retry, for the run's notes. */
  problems: string[];
}

/**
 * Write one section's content in batches of about `BATCH_SIZE`. Each batch is
 * told everything the section (and `before`, items already in the book) holds
 * so far, so later batches cover new ground instead of repeating earlier
 * ones. Stops when the section is full or a batch adds nothing new.
 */
export async function writeSection(sec: PlannedSection, ask: ContentAsk, before: string[] = [], limits: ProviderLimits = DEFAULT_LIMITS): Promise<WriteResult> {
  const need = sec.content;
  const problems: string[] = [];
  if (!need) return { config: sec.config, batches: 0, problems };
  const seen: Seen = { prompt: [], saying: [], affirmation: [], puzzles: [] };
  let cfg = withItems(sec.config, []);
  let runId: string | undefined;
  let batches = 0;
  const size = limits.batch[need.task];
  const maxBatches = Math.ceil(need.count / size) + 2;
  while (contentCount(cfg) < need.count && batches < maxBatches) {
    const missing = need.count - contentCount(cfg);
    // A little extra in the last batch: a few items may be dropped as repeats.
    const count = missing > size ? size : Math.min(size, missing + Math.ceil(missing / 10));
    const avoid = [...before, ...avoidFor(cfg, seen, limits.avoid)].slice(-limits.avoid);
    batches++;
    const a = await askSafely(ask, { need, sectionTitle: sec.label, count, avoid }, problems);
    if (!a) break;
    runId ??= a.runId;
    const r = keep(cfg, need, newItems(cfg, a.output), missing, seen);
    if (!r.kept.length) break;
    cfg = withItems(cfg, [...itemsOf(cfg), ...r.kept]);
  }
  if (runId) cfg = { ...cfg, aiRunId: runId } as GeneratorConfig;
  return { config: cfg, batches, runId, problems };
}

// ---------------------------------------------------------------------------
// Review: flag weak items and rewrite them

type TextKind = "prompt" | "affirmation" | "saying";

const textKind = (cfg: GeneratorConfig): TextKind | null => (cfg.kind === "journal-prompts" ? "prompt" : cfg.kind === "gratitude" ? "affirmation" : cfg.kind === "cryptogram" ? "saying" : null);

/** Share of a section that may open with the same two words ("What is…", "I am…"). */
const OPENER_SHARE: Record<TextKind, number> = { prompt: 0.15, affirmation: 0.25, saying: 0.25 };
const openerLimit = (kind: TextKind, n: number) => Math.max(2, Math.ceil(n * OPENER_SHARE[kind]));

/** Rule-based weak spots: yes/no or vague prompts, affirmations not in the first person, sayings too short for a cryptogram. */
function ruleProblem(kind: TextKind, item: string, maxLength: number): string | null {
  const issues = kind === "prompt" ? promptProblems(item) : phraseProblems(item, kind, maxLength);
  return issues[0]?.message ?? null;
}

/**
 * Items of one section a reader would find weak, by index: rule-based
 * problems, openings used more often than the section allows (the later
 * ones are flagged), and anything the model review (`modelWeak`) named.
 */
export function weakItems(kind: TextKind, items: string[], maxLength: number, modelWeak: { item: number; problem: string }[] = []): Map<number, string> {
  const out = new Map<number, string>();
  items.forEach((it, i) => {
    const p = ruleProblem(kind, it, maxLength);
    if (p) out.set(i, p);
  });
  const limit = openerLimit(kind, items.length);
  const counts = new Map<string, number>();
  items.forEach((it, i) => {
    const k = openerKey(it);
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n > limit && !out.has(i)) out.set(i, `Starts like ${n - 1} other items ("${k}…")`);
  });
  for (const w of modelWeak) {
    const i = w.item - 1;
    if (i >= 0 && i < items.length && !out.has(i)) out.set(i, w.problem.trim() || "Weak");
  }
  return out;
}

export type ContentReview = (req: { kind: TextKind; sectionTitle: string; theme: string; items: string[] }) => Promise<{ weak: { item: number; problem: string }[]; runId?: string }>;

export interface ReviewResult {
  sections: PlannedSection[];
  /** Items flagged as weak. */
  flagged: number;
  /** Flagged items replaced with better ones. */
  rewritten: number;
  notes: string[];
}

/** At most this share of a section is rewritten, so one harsh review can't churn a whole section. */
const MAX_REWRITE_SHARE = 0.3;

/**
 * Review every prompt, affirmation and saying section: flag weak items (rule
 * checks plus an optional model review), then ask for replacements that
 * avoid the rest of the book and fix the named problems. A replacement takes
 * the weak item's place only when it passes the same checks; otherwise the
 * original stays.
 */
export async function reviewContent(sections: PlannedSection[], review: ContentReview | null, ask: ContentAsk, limits: ProviderLimits = DEFAULT_LIMITS): Promise<ReviewResult> {
  const out = sections.map((s) => ({ ...s }));
  const targets = out.filter((s) => s.content && textKind(s.config) && contentCount(s.config) > 0);
  const ofKind = (kind: TextKind, not: PlannedSection) => out.filter((o) => o !== not && textKind(o.config) === kind).flatMap((o) => itemsOf(o.config) as string[]);

  const failures: string[] = [];
  // Reviews and replacement requests run in parallel (up to the provider's limit); replacements are then applied in
  // reading order, each checked against the book as it stands, so two sections can't take the same new item.
  const plans = await pool(targets, limits.concurrency, async (s) => {
    const kind = textKind(s.config)!;
    const items = itemsOf(s.config) as string[];
    const maxLength = s.content!.task === "phrases" ? s.content!.maxLength : 160;
    const model = review ? await softly(review({ kind, sectionTitle: s.label, theme: s.content!.theme, items })) : null;
    const weak = weakItems(kind, items, maxLength, model?.weak);
    if (!weak.size) return null;
    const fix = [...weak.keys()].slice(0, Math.max(1, Math.floor(items.length * MAX_REWRITE_SHARE)));
    const problems = [...new Set(fix.map((i) => weak.get(i)!))].slice(0, 6).join("; ");
    const limit = openerLimit(kind, items.length);
    const crowded = [...new Set(items.map(openerKey))].filter((k) => items.filter((x) => openerKey(x) === k).length >= limit);
    const feedback = `These replace weak items (${problems}). Make each one strong on its own${crowded.length ? ` and don't start with ${crowded.map((o) => `"${o}"`).join(", ")}` : ""}.`.slice(0, 500);
    const avoid = [...ofKind(kind, s), ...items].slice(-limits.avoid);
    const a = await askSafely(ask, { need: s.content!, sectionTitle: s.label, count: fix.length + Math.ceil(fix.length / 3) + 1, avoid, feedback }, failures);
    return { s, kind, maxLength, flagged: weak.size, fix, answer: a, reviewRunId: model?.runId };
  });

  let flagged = 0;
  let rewritten = 0;
  for (const plan of plans) {
    if (!plan) continue;
    const { s, kind, maxLength, fix, answer } = plan;
    flagged += plan.flagged;
    if (!answer) continue;
    const fresh = [...(newItems(s.config, answer.output) as string[])];
    const next = [...(itemsOf(s.config) as string[])];
    const book = ofKind(kind, s);
    const limit = openerLimit(kind, next.length);
    let changed = 0;
    for (const i of fix) {
      const others = next.filter((_, j) => j !== i);
      let chosen: string | null = null;
      const at = fresh.findIndex((c) => {
        const t = keepOne(kind, c, maxLength, [...book, ...others]);
        if (!t || others.filter((x) => openerKey(x) === openerKey(t)).length >= limit) return false;
        chosen = t;
        return true;
      });
      if (at < 0 || !chosen) continue;
      next[i] = chosen;
      fresh.splice(at, 1);
      changed++;
    }
    if (!changed) continue;
    rewritten += changed;
    s.config = withItems(s.config, next);
    const runId = answer.runId ?? plan.reviewRunId;
    if (runId && !("aiRunId" in s.config && s.config.aiRunId)) s.config = { ...s.config, aiRunId: runId } as GeneratorConfig;
  }
  const notes = flagged ? [`Content review: flagged ${flagged} weak item(s)${rewritten ? ` and rewrote ${rewritten}` : ""}.`] : [];
  notes.push(...failures);
  return { sections: out, flagged, rewritten, notes };
}

/** The tidied item when it is usable, new to `seen` and free of rule problems; otherwise null. */
function keepOne(kind: TextKind, item: string, maxLength: number, seen: string[]): string | null {
  const r = kind === "prompt" ? cleanPrompts([item], seen) : cleanPhrases([item], kind, maxLength, seen);
  const t = r.kept[0];
  return t && !ruleProblem(kind, t, maxLength) ? t : null;
}

export interface RefineResult {
  sections: PlannedSection[];
  /** Items dropped as repeats or unusable. */
  removed: number;
  /** Replacement items written. */
  added: number;
  /** Items filled in from the built-in banks after the model came up short. */
  banked: number;
  notes: string[];
}

export interface RefineOptions {
  /** Top-up rounds asking the model for what is missing. */
  rounds?: number;
  limits?: ProviderLimits;
  /**
   * Last resort for a section still short after the top-ups: the built-in
   * banks. Their items pass the same checks, so a full book never means a
   * repeated or unusable item.
   */
  fallback?: ContentAsk;
}

const NOUN: Record<string, string> = { "journal-prompts": "prompts", cryptogram: "sayings", gratitude: "affirmations" };

/**
 * Check every section's content against the rest of the book, drop repeats
 * and unusable items, and ask for replacements (up to `rounds` times). A
 * section still short then takes items from `fallback` (the built-in banks).
 * Only if that comes up short too does it keep fewer items; its unused pages
 * become notes pages when the book is assembled.
 */
export async function refineContent(sections: PlannedSection[], ask: ContentAsk, opts: RefineOptions = {}): Promise<RefineResult> {
  const { rounds = 3, limits = DEFAULT_LIMITS, fallback } = opts;
  const seen: Seen = { prompt: [], saying: [], affirmation: [], puzzles: [] };
  const problems: string[] = [];
  let removed = 0;
  let added = 0;
  let banked = 0;
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
    const answers = await pool(short, limits.concurrency, async (s) => {
      const missing = s.content!.count - contentCount(s.config);
      // Ask for a little extra (some of the new items may repeat too), but no more than one batch.
      const count = Math.min(s.content!.count, limits.batch[s.content!.task], missing + Math.ceil(missing / 4) + 1);
      return askSafely(ask, { need: s.content!, sectionTitle: s.label, count, avoid: avoidFor(s.config, seen, limits.avoid) }, problems);
    });
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

  // Last resort: fill what the model couldn't from the built-in banks, in reading order.
  const notes: string[] = [];
  if (fallback) {
    for (const s of out) {
      if (!s.content || contentCount(s.config) >= s.content.count) continue;
      const missing = s.content.count - contentCount(s.config);
      const a = await askSafely(fallback, { need: s.content, sectionTitle: s.label, count: missing + Math.ceil(missing / 4) + 2, avoid: avoidFor(s.config, seen) }, problems);
      if (!a) continue;
      const r = keep(s.config, s.content, newItems(s.config, a.output), missing, seen);
      if (!r.kept.length) continue;
      banked += r.kept.length;
      s.config = withItems(s.config, [...itemsOf(s.config), ...r.kept]);
      notes.push(`${s.label}: ${r.kept.length} of ${s.content.count} ${NOUN[s.config.kind] ?? "puzzles"} came from the built-in bank because the model came up short.`);
    }
  }

  if (removed) notes.push(`Content check: removed ${removed} repeated or unusable item(s)${added ? ` and wrote ${added} replacement(s)` : ""}.`);
  for (const s of out) {
    if (!s.content) continue;
    const n = contentCount(s.config);
    // Gratitude pages cycle through their affirmations, so a short list costs no pages, only repeats.
    if (s.config.kind === "gratitude") {
      if (n < s.content.count) notes.push(`${s.label}: ${n} distinct affirmation(s) for ${s.content.count} pages; some pages repeat one.`);
      continue;
    }
    if (n < s.content.count) notes.push(`${s.label}: needed ${s.content.count}, kept ${n} distinct; the rest of its page budget became notes pages.`);
  }
  notes.push(...problems);
  return { sections: out, removed, added, banked, notes };
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
    else if (o.kind === "crossword") seen.puzzles.push(...o.puzzles.map(asWords));
  }
  const old = itemsOf(cfg);
  const oldText = old.map((x) => (typeof x === "string" ? x : (x as { title: string }).title));
  const target = need.count;
  let items: unknown[] = [];
  let runId: string | undefined;
  for (let round = 0; round < 2 && items.length < target; round++) {
    const missing = target - items.length;
    const count = Math.min(target + 4, missing + Math.ceil(missing / 4) + 1);
    const avoid = [...avoidFor(cfg, seen), ...oldText].slice(-200);
    const a = await askSafely(ask, { need, sectionTitle: opts.sectionTitle, count, avoid, feedback: opts.feedback }, []);
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
