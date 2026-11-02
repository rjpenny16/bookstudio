/**
 * Versioned Amazon KDP Kindle eBook rule set (fixed-layout page-image eBooks).
 *
 * KDP's help pages could not be read directly while this was written; values come from
 * KDP help as quoted by search results and from several 2026 guides, and are marked
 * `verify` where only one source gave them.
 *
 * Sources:
 * - Fixed-layout EPUB metadata KDP requires: https://publishing.co.uk/guides/kdp-error-kindle-fixed-layout-missing/
 * - EPUB vs MOBI (MOBI retired for fixed layout, Mar 18 2025): https://publishing.co.uk/guides/epub-vs-mobi-2026/
 * - Royalty bands, the $12.99 ceiling from Jul 7 2026, delivery fee: https://www.kdpeasy.com/guides/2026-kdp-royalty-rates
 *   and https://ebookdone.com/tools/kindle-royalty-calculator
 * - 35% minimum price by file size (verify): https://cartmango.com/kdp-royalties/
 */

import type { BookType } from "@/lib/schema/project";

export const RULES_VERSION_EBOOK = "kdp-ebook-2026.11";

/** Amazon.com Kindle royalty. The 70% band pays a delivery fee per megabyte of the file. */
export const EBOOK_ROYALTY_US = {
  highRate: 0.7,
  highMinUsd: 2.99,
  highMaxUsd: 12.99,
  deliveryPerMbUsd: 0.15,
  deliveryMinUsd: 0.01,
  lowRate: 0.35,
  lowMaxUsd: 200,
} as const;

/** Lowest list price by file size at 35% (verify). */
export const EBOOK_MIN_PRICE_BY_SIZE: { maxMb: number; minUsd: number }[] = [
  { maxMb: 3, minUsd: 0.99 },
  { maxMb: 10, minUsd: 1.99 },
  { maxMb: Infinity, minUsd: 2.99 },
];

/** Largest eBook file KDP accepts, MB (verify). */
export const EBOOK_MAX_FILE_MB = 650;

/** Kindle cover image, pixels (1:1.6; verify). */
export const EBOOK_COVER_PX = { width: 1600, height: 2560 } as const;

/** Page image size presets: pixels on the page's long side. */
export const EBOOK_IMAGE_PRESETS = { standard: 1600, sharp: 2560 } as const;
export type EbookImagePreset = keyof typeof EBOOK_IMAGE_PRESETS;

/** JPEG quality for page images. */
export const EBOOK_JPEG_QUALITY = 0.85;

/** Book types readers write or draw in: a Kindle reader can only view or print their pages. */
export const FILL_IN_TYPES: BookType[] = ["notebook", "journal", "planner", "log-book", "puzzle", "activity", "coloring"];

/** Book types that are mostly blank pages, which KDP is likely to reject as an eBook. */
export const MOSTLY_BLANK_TYPES: BookType[] = ["notebook"];
