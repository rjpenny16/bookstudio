/**
 * KDP's weekly title limits.
 * Source: https://www.kdpcommunity.com/s/article/KDP-Title-Creation-Limits-Update
 *
 * - From Monday, September 21, 2026: up to 2 new titles created per format per week.
 * - From October 5, 2026: up to 2 new titles submitted for publication per format per week.
 *   The first submission counts (drafts included); updates to submitted titles don't.
 * - eBook, paperback and hardcover each have their own allowance.
 * - Existing titles are not affected.
 * - The week resets every Sunday at 12:00 AM UTC.
 */
export const TITLE_LIMITS = {
  version: "kdp-limits-2026.10",
  source: "https://www.kdpcommunity.com/s/article/KDP-Title-Creation-Limits-Update",
  creationsPerFormatPerWeek: 2,
  submissionsPerFormatPerWeek: 2,
  /** Day of the week (0 = Sunday, UTC) the allowance resets at 00:00. */
  resetDayUtc: 0,
} as const;
