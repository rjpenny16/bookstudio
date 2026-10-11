/**
 * Versioned Amazon KDP paperback rule set.
 *
 * Marketplace rules are external requirements, not timeless constants. Everything
 * that KDP can change lives here (one place, one version string) so that the UI,
 * the preflight engine, the calculators and the AI agent all read the same values.
 *
 * Sources (KDP Help): "Paperback Submission Guidelines", "Set Trim Size, Bleed, and
 * Margins", "Create a Paperback Cover", "Printing Cost", "Paperback Royalty",
 * "Low-Content Books", "Content Guidelines (AI disclosure)". Values marked
 * `verify` are best-known values that should be confirmed against the live
 * KDP pages before relying on them commercially.
 */

import type { InteriorInk, Paper } from "@/lib/schema/project";

export const RULES_VERSION = "kdp-paperback-2026.10";

export interface TrimSize {
  id: string;
  label: string;
  widthIn: number;
  heightIn: number;
  note?: string;
}

export const TRIM_SIZES: TrimSize[] = [
  { id: "5x8", label: '5" x 8"', widthIn: 5, heightIn: 8 },
  { id: "5.06x7.81", label: '5.06" x 7.81"', widthIn: 5.06, heightIn: 7.81 },
  { id: "5.25x8", label: '5.25" x 8"', widthIn: 5.25, heightIn: 8 },
  { id: "5.5x8.5", label: '5.5" x 8.5"', widthIn: 5.5, heightIn: 8.5 },
  { id: "6x9", label: '6" x 9"', widthIn: 6, heightIn: 9, note: "Most common trade size" },
  { id: "6.14x9.21", label: '6.14" x 9.21"', widthIn: 6.14, heightIn: 9.21 },
  { id: "6.69x9.61", label: '6.69" x 9.61"', widthIn: 6.69, heightIn: 9.61 },
  { id: "7x10", label: '7" x 10"', widthIn: 7, heightIn: 10 },
  { id: "7.44x9.69", label: '7.44" x 9.69"', widthIn: 7.44, heightIn: 9.69 },
  { id: "7.5x9.25", label: '7.5" x 9.25"', widthIn: 7.5, heightIn: 9.25 },
  { id: "8x10", label: '8" x 10"', widthIn: 8, heightIn: 10 },
  { id: "8.25x6", label: '8.25" x 6"', widthIn: 8.25, heightIn: 6 },
  { id: "8.25x8.25", label: '8.25" x 8.25"', widthIn: 8.25, heightIn: 8.25 },
  { id: "8.5x8.5", label: '8.5" x 8.5"', widthIn: 8.5, heightIn: 8.5 },
  { id: "8.5x11", label: '8.5" x 11"', widthIn: 8.5, heightIn: 11, note: "Letter; popular for workbooks and puzzles" },
  { id: "8.27x11.69", label: '8.27" x 11.69" (A4)', widthIn: 8.27, heightIn: 11.69 },
  { id: "8.25x11", label: '8.25" x 11"', widthIn: 8.25, heightIn: 11 },
];

/** Interior bleed: added to the outside edge, top and bottom of every page. */
export const BLEED_IN = 0.125;

/** Spine width per page, inches. */
export const SPINE_PER_PAGE_IN: Record<Paper, Record<InteriorInk, number>> = {
  white: { black: 0.002252, "standard-color": 0.002252, "premium-color": 0.002347 },
  cream: { black: 0.0025, "standard-color": 0.0025, "premium-color": 0.0025 },
};

export interface PageRange {
  min: number;
  max: number;
}

export function pageRange(ink: InteriorInk, paper: Paper): PageRange {
  if (ink === "standard-color") return { min: 72, max: 600 };
  if (ink === "premium-color") return { min: 24, max: 828 };
  return paper === "cream" ? { min: 24, max: 776 } : { min: 24, max: 828 };
}

/** Which paper/ink combinations KDP offers. Cream paper is black-ink only. */
export function isValidPaperInk(paper: Paper, ink: InteriorInk): boolean {
  return paper === "white" || ink === "black";
}

/** Inside (gutter) margin by page count. Outside/top/bottom min depends on bleed. */
export const GUTTER_TABLE: { maxPages: number; gutterIn: number }[] = [
  { maxPages: 150, gutterIn: 0.375 },
  { maxPages: 300, gutterIn: 0.5 },
  { maxPages: 500, gutterIn: 0.625 },
  { maxPages: 700, gutterIn: 0.75 },
  { maxPages: 828, gutterIn: 0.875 },
];
export const OUTSIDE_MARGIN_NO_BLEED_IN = 0.25;
export const OUTSIDE_MARGIN_BLEED_IN = 0.375;

/** Cover rules. */
export const COVER_BLEED_IN = 0.125;
/** Keep text and important art this far inside the trim on front and back. */
export const COVER_SAFE_IN = 0.125;
/** Spine text must stay this far from each spine fold. */
export const SPINE_TEXT_MARGIN_IN = 0.0625;
/** KDP only allows spine text when the book has MORE than 79 pages. */
export const SPINE_TEXT_MIN_PAGES = 80;
/** KDP barcode area on the back cover, lower right. */
export const BARCODE = { widthIn: 2, heightIn: 1.2, fromSpineIn: 0.25, fromBottomIn: 0.25 } as const;

export const MIN_IMAGE_DPI = 300;
export const LOW_IMAGE_DPI_ERROR = 150;

/** Consecutive blank page limits (verify). */
export const MAX_CONSECUTIVE_BLANK_BODY = 2;
export const MAX_CONSECUTIVE_BLANK_END = 10;

/** Listing limits. */
export const LISTING = {
  maxTitleSubtitleChars: 200,
  maxDescriptionChars: 4000,
  maxKeywords: 7,
  maxKeywordChars: 50,
  maxCategories: 3,
} as const;

/**
 * Terms KDP disallows or discourages in titles/keywords (misleading claims, Amazon
 * program names, pricing claims). Matching is case-insensitive on word boundaries.
 */
export const PROHIBITED_LISTING_TERMS = [
  "bestseller",
  "best seller",
  "best-selling",
  "bestselling",
  "#1",
  "free",
  "kindle unlimited",
  "amazon",
  "kdp",
  "new release",
  "on sale",
  "discount",
  "cheap",
  "limited time",
] as const;

/**
 * US marketplace printing cost (verify: KDP publishes these per marketplace and
 * revises them; the June 2025 revision is the latest reflected here).
 */
export interface PrintCostRule {
  ink: InteriorInk;
  large: boolean;
  /** Flat cost when pages <= flatMaxPages. */
  flatMaxPages: number;
  flatUsd: number;
  fixedUsd: number;
  perPageUsd: number;
}

export const PRINT_COST_US: PrintCostRule[] = [
  { ink: "black", large: false, flatMaxPages: 108, flatUsd: 2.3, fixedUsd: 1.0, perPageUsd: 0.012 },
  { ink: "black", large: true, flatMaxPages: 108, flatUsd: 2.84, fixedUsd: 1.0, perPageUsd: 0.017 },
  { ink: "premium-color", large: false, flatMaxPages: 40, flatUsd: 3.65, fixedUsd: 1.0, perPageUsd: 0.065 },
  { ink: "premium-color", large: true, flatMaxPages: 40, flatUsd: 4.2, fixedUsd: 1.0, perPageUsd: 0.08 },
  { ink: "standard-color", large: false, flatMaxPages: 0, flatUsd: 0, fixedUsd: 1.0, perPageUsd: 0.0255 },
  { ink: "standard-color", large: true, flatMaxPages: 0, flatUsd: 0, fixedUsd: 1.0, perPageUsd: 0.0325 },
];

/** Amazon.com paperback royalty: 60% at or above the threshold price, 50% below. Expanded distribution 40%. */
export const ROYALTY_US = { highRate: 0.6, lowRate: 0.5, thresholdUsd: 9.99, expandedRate: 0.4 } as const;

export const LARGE_TRIM = { widthIn: 6.12, heightIn: 9 } as const;
