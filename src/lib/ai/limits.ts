/**
 * How hard the content writer may lean on a provider: how many calls run at
 * once, how many items one call asks for, and how many earlier items it is
 * told to avoid. Shared by the server (which reports them) and the browser
 * (which batches by them).
 */

export type ContentTask = "journal-prompts" | "word-lists" | "crossword-clues" | "phrases";

export interface ProviderLimits {
  /** Model calls in flight at once. */
  concurrency: number;
  /** Items (prompts, sayings or whole puzzles) asked for per call, by task. */
  batch: Record<ContentTask, number>;
  /** Most earlier items sent back as "avoid". */
  avoid: number;
}

/** API providers: long lists in one call drift into repeats and run out of output room past about 30. */
export const DEFAULT_LIMITS: ProviderLimits = {
  concurrency: 3,
  batch: { "journal-prompts": 30, phrases: 30, "word-lists": 30, "crossword-clues": 30 },
  avoid: 200,
};

/**
 * codex runs each call as a CLI process that can take minutes; a big batch is
 * the one most likely to time out or come back malformed, and losing it loses
 * the most. Smaller batches (a crossword is ~15 clues, so 4 is ~60 clues),
 * fewer at once (ChatGPT usage limits) and a shorter avoid list (the code
 * checks for repeats anyway) keep calls quick and cheap to retry.
 */
export function codexLimits(env: Record<string, string | undefined> = {}): ProviderLimits {
  const n = Number.parseInt(env.CODEX_CONCURRENCY ?? "", 10);
  return {
    concurrency: Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 2,
    batch: { "journal-prompts": 20, phrases: 20, "word-lists": 8, "crossword-clues": 4 },
    avoid: 80,
  };
}
