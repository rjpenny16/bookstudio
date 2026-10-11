import type { PrintSpec } from "@/lib/schema/project";
import { inToPt } from "@/lib/util/ids";
import {
  BARCODE,
  BLEED_IN,
  COVER_BLEED_IN,
  COVER_SAFE_IN,
  GUTTER_TABLE,
  LARGE_TRIM,
  OUTSIDE_MARGIN_BLEED_IN,
  OUTSIDE_MARGIN_NO_BLEED_IN,
  PRINT_COST_US,
  ROYALTY_US,
  SPINE_PER_PAGE_IN,
  SPINE_TEXT_MARGIN_IN,
  SPINE_TEXT_MIN_PAGES,
  TRIM_SIZES,
} from "./rules";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function findTrim(id: string) {
  return TRIM_SIZES.find((t) => t.id === id);
}

export function isLargeTrim(widthIn: number, heightIn: number): boolean {
  return widthIn > LARGE_TRIM.widthIn || heightIn > LARGE_TRIM.heightIn;
}

export function gutterIn(pageCount: number): number {
  for (const row of GUTTER_TABLE) if (pageCount <= row.maxPages) return row.gutterIn;
  return GUTTER_TABLE[GUTTER_TABLE.length - 1].gutterIn;
}

export function outsideMarginIn(bleed: boolean): number {
  return bleed ? OUTSIDE_MARGIN_BLEED_IN : OUTSIDE_MARGIN_NO_BLEED_IN;
}

/** Pages are 1-based in print; index 0 is page 1, a right-hand (recto) page. */
export function isRecto(pageIndex: number): boolean {
  return pageIndex % 2 === 0;
}

export interface InteriorGeometry {
  trimW: number;
  trimH: number;
  /** PDF page size (trim + bleed when bleed is on). */
  pageW: number;
  pageH: number;
  bleed: number;
  gutter: number;
  outside: number;
}

export function interiorGeometry(spec: PrintSpec, pageCount: number): InteriorGeometry {
  const bleed = spec.bleed ? inToPt(BLEED_IN) : 0;
  const trimW = inToPt(spec.widthIn);
  const trimH = inToPt(spec.heightIn);
  return {
    trimW,
    trimH,
    pageW: trimW + bleed,
    pageH: trimH + bleed * 2,
    bleed,
    gutter: inToPt(gutterIn(Math.max(pageCount, 24))),
    outside: inToPt(outsideMarginIn(spec.bleed)),
  };
}

/** Trim-relative offset of the trim box inside the PDF page (bleed sits on the outside edge). */
export function trimOffset(g: InteriorGeometry, pageIndex: number): { x: number; y: number } {
  return { x: isRecto(pageIndex) ? 0 : g.bleed, y: g.bleed };
}

/** Live (safe) area of an interior page in trim coordinates, gutter-aware. */
export function safeArea(g: InteriorGeometry, pageIndex: number): Box {
  const left = isRecto(pageIndex) ? g.gutter : g.outside;
  const right = isRecto(pageIndex) ? g.outside : g.gutter;
  return { x: left, y: g.outside, width: g.trimW - left - right, height: g.trimH - g.outside * 2 };
}

/** Parity-independent content box: gutter-width margin on both sides. Used by generators. */
export function symmetricContentBox(g: InteriorGeometry, minSideIn = 0.5): Box {
  const side = Math.max(g.gutter, inToPt(minSideIn));
  const top = Math.max(g.outside, inToPt(minSideIn));
  return { x: side, y: top, width: g.trimW - side * 2, height: g.trimH - top * 2 };
}

/** Area an element may cover when it is meant to print to the edge (trim + outside bleed). */
export function bleedArea(g: InteriorGeometry, pageIndex: number): Box {
  if (!g.bleed) return { x: 0, y: 0, width: g.trimW, height: g.trimH };
  return isRecto(pageIndex)
    ? { x: 0, y: -g.bleed, width: g.trimW + g.bleed, height: g.trimH + g.bleed * 2 }
    : { x: -g.bleed, y: -g.bleed, width: g.trimW + g.bleed, height: g.trimH + g.bleed * 2 };
}

export function spineWidthIn(spec: PrintSpec, pageCount: number): number {
  return pageCount * SPINE_PER_PAGE_IN[spec.paper][spec.ink];
}

export interface CoverGeometry {
  /** Full PDF size incl. bleed, points. */
  width: number;
  height: number;
  bleed: number;
  trimW: number;
  trimH: number;
  spine: number;
  /** Boxes in cover coordinates (origin = top-left of bleed box). */
  back: Box;
  spineBox: Box;
  front: Box;
  backSafe: Box;
  frontSafe: Box;
  spineSafe: Box;
  barcode: Box;
  spineTextAllowed: boolean;
}

export function coverGeometry(spec: PrintSpec, pageCount: number): CoverGeometry {
  const bleed = inToPt(COVER_BLEED_IN);
  const trimW = inToPt(spec.widthIn);
  const trimH = inToPt(spec.heightIn);
  const spine = inToPt(spineWidthIn(spec, pageCount));
  const safe = inToPt(COVER_SAFE_IN);
  const spineMargin = inToPt(SPINE_TEXT_MARGIN_IN);
  const back: Box = { x: bleed, y: bleed, width: trimW, height: trimH };
  const spineBox: Box = { x: bleed + trimW, y: bleed, width: spine, height: trimH };
  const front: Box = { x: bleed + trimW + spine, y: bleed, width: trimW, height: trimH };
  const bw = inToPt(BARCODE.widthIn);
  const bh = inToPt(BARCODE.heightIn);
  return {
    width: bleed * 2 + trimW * 2 + spine,
    height: bleed * 2 + trimH,
    bleed,
    trimW,
    trimH,
    spine,
    back,
    spineBox,
    front,
    backSafe: { x: back.x + safe, y: back.y + safe, width: trimW - safe * 2, height: trimH - safe * 2 },
    frontSafe: { x: front.x + safe, y: front.y + safe, width: trimW - safe * 2, height: trimH - safe * 2 },
    spineSafe: {
      x: spineBox.x + spineMargin,
      y: spineBox.y + safe,
      width: Math.max(0, spine - spineMargin * 2),
      height: trimH - safe * 2,
    },
    barcode: {
      x: spineBox.x - inToPt(BARCODE.fromSpineIn) - bw,
      y: back.y + trimH - inToPt(BARCODE.fromBottomIn) - bh,
      width: bw,
      height: bh,
    },
    spineTextAllowed: pageCount >= SPINE_TEXT_MIN_PAGES,
  };
}

export function printCostUsd(spec: PrintSpec, pageCount: number): number {
  const large = isLargeTrim(spec.widthIn, spec.heightIn);
  const rule = PRINT_COST_US.find((r) => r.ink === spec.ink && r.large === large);
  if (!rule) return NaN;
  const cost = pageCount <= rule.flatMaxPages ? rule.flatUsd : rule.fixedUsd + rule.perPageUsd * pageCount;
  return Math.round(cost * 100) / 100;
}

export interface RoyaltyResult {
  printCost: number;
  rate: number;
  royalty: number;
  expandedRoyalty: number;
  /** Lowest price at which the royalty is non-negative. */
  minListPrice: number;
}

export function royaltyUsd(spec: PrintSpec, pageCount: number, listPrice: number): RoyaltyResult {
  const printCost = printCostUsd(spec, pageCount);
  const rate = listPrice >= ROYALTY_US.thresholdUsd ? ROYALTY_US.highRate : ROYALTY_US.lowRate;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const minAtLow = printCost / ROYALTY_US.lowRate;
  const minListPrice = minAtLow < ROYALTY_US.thresholdUsd ? minAtLow : Math.max(ROYALTY_US.thresholdUsd, printCost / ROYALTY_US.highRate);
  return {
    printCost,
    rate,
    royalty: r2(listPrice * rate - printCost),
    expandedRoyalty: r2(listPrice * ROYALTY_US.expandedRate - printCost),
    minListPrice: Math.ceil(minListPrice * 100) / 100,
  };
}

export function boxContains(outer: Box, inner: Box, tolerance = 0.01): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
