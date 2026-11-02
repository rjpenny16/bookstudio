/**
 * Versioned Amazon KDP hardcover (case laminate) rule set.
 *
 * KDP's hardcover help pages could not be read directly while this was written, so
 * every value below comes from KDP's help pages as quoted by search results or from
 * several independent guides, and is marked `verify`. Cover dimensions in particular
 * disagree between sources (the wrap is given as 0.51" and as 0.591"), which is why
 * preflight asks for the full cover size from KDP's own cover calculator and can
 * adopt it (see `coverAdjust` on PrintSpec).
 *
 * Sources:
 * - KDP Help "Hardcover": https://kdp.amazon.com/en_US/help/topic/GAVW3FZZAKA2KY3B (75-550 pages)
 * - KDP Help "Hardcover Printing Cost": https://kdp.amazon.com/en_US/help/topic/GHT976ZKSKUXBB6H
 *   (fixed cost + pages x per-page cost; 300 black pages = $5.65 + 300 x $0.012 = $9.25)
 * - Wrap and hinge: https://kdpprintcover.com/blog/understanding-kdp-hardcover-wrap-hinge/
 * - Spine board allowance and panel widths: https://www.inkfluenceai.com/blog/kdp-cover-size-spine-width-calculator-2026
 * - Trims: https://publish.ai/kdp-trim-sizes
 */

import type { InteriorInk } from "@/lib/schema/project";

export const RULES_VERSION_HARDCOVER = "kdp-hardcover-2026.11";

/** Trim ids (from the paperback TRIM_SIZES list) KDP offers in hardcover (verify). */
export const HARDCOVER_TRIM_IDS = ["5.5x8.5", "6x9", "6.14x9.21", "7x10", "8.25x11"] as const;

/** Page range for every ink and paper (KDP Help "Hardcover"). */
export const HARDCOVER_PAGE_RANGE = { min: 75, max: 550 } as const;

/** Hardcovers print in black or premium color; standard color is not offered (verify). */
export const HARDCOVER_INKS: InteriorInk[] = ["black", "premium-color"];

/** Case-laminate cover layout, inches (all verify). */
export const HARDCOVER_COVER = {
  /** Printed cover that wraps around the board edges, on all four sides. Sources give 0.51" and 0.591" (15 mm). */
  wrapIn: 0.591,
  /** Each board is this much wider than the trim. */
  boardExtraWidthIn: 0.197,
  /** Each board is this much taller than the trim, in total (top plus bottom). */
  boardExtraHeightIn: 0.25,
  /** Added to the page-block thickness for the spine boards. */
  spineBoardIn: 0.187,
  /** The hinge (where the board bends) on the front and back, next to the spine. Keep text off it. */
  hingeIn: 0.4,
  /** Keep text this far inside the board edges. */
  safeIn: 0.125,
} as const;

/** US printing cost: fixed + pages x per-page (KDP Help "Hardcover Printing Cost"; premium color is verify). */
export const HARDCOVER_PRINT_COST_US: Record<"black" | "premium-color", { fixedUsd: number; perPageUsd: number }> = {
  black: { fixedUsd: 5.65, perPageUsd: 0.012 },
  "premium-color": { fixedUsd: 5.65, perPageUsd: 0.065 },
};

/** Amazon.com hardcover royalty: 60% at or above the threshold price, 50% below (verify). */
export const HARDCOVER_ROYALTY_US = { highRate: 0.6, lowRate: 0.5, thresholdUsd: 9.99 } as const;

/** How close BookStudio's cover size must be to the size from KDP's cover calculator, inches. */
export const COVER_SIZE_TOLERANCE_IN = 0.02;
