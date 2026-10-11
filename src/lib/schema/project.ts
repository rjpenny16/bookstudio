/**
 * BookStudio canonical project schema.
 *
 * This is the application-owned, renderer-neutral document model. Fabric.js (the
 * editor) and pdf-lib (the print renderer) are both just renderers of this data.
 * All geometry is in PostScript points (1/72 inch), origin top-left, y down.
 *
 * - Interior element coordinates are relative to the TRIM box of the page. Negative
 *   values / values beyond the trim reach into bleed.
 * - Cover element coordinates are relative to the full cover BLEED box
 *   (back + spine + front, including bleed on all four sides).
 */

import type { GeneratorConfig } from "@/lib/generators/pages";

export const SCHEMA_VERSION = "1.1";

export type InteriorInk = "black" | "standard-color" | "premium-color";
export type Paper = "white" | "cream";

export interface PrintSpec {
  marketplace: "amazon-kdp";
  binding: "paperback";
  trimId: string;
  widthIn: number;
  heightIn: number;
  /** Interior bleed (pages print to the edge). */
  bleed: boolean;
  paper: Paper;
  ink: InteriorInk;
  coverFinish: "matte" | "glossy";
  /** Version of the marketplace rule set the project was validated against. */
  rulesVersion: string;
}

export type BookType =
  | "notebook"
  | "journal"
  | "planner"
  | "log-book"
  | "puzzle"
  | "coloring"
  | "activity"
  | "other";

export type ArtifactOrigin = "human" | "generated" | "ai-generated" | "user-upload";

export interface ArtifactProvenance {
  origin: ArtifactOrigin;
  /** Model run that produced this artifact (for ai-generated). */
  runId?: string;
  /** Deterministic generator that produced it (for generated). */
  generator?: string;
  humanEdited?: boolean;
}

interface BaseElement {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise, around the element's center. */
  rotation: number;
  opacity?: number;
  locked?: boolean;
  provenance?: ArtifactProvenance;
}

export interface RectElement extends BaseElement {
  type: "rect";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  cornerRadius: number;
}

export interface EllipseElement extends BaseElement {
  type: "ellipse";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

/** A line from (x, y) to (x + width, y + height). Width/height may be negative. */
export interface LineElement extends BaseElement {
  type: "line";
  stroke: string;
  strokeWidth: number;
  dash?: number[];
  cap?: "butt" | "round";
}

export type TextAlign = "left" | "center" | "right";

export interface TextElement extends BaseElement {
  type: "text";
  text: string;
  fontFamily: string;
  bold: boolean;
  fontSize: number;
  color: string;
  align: TextAlign;
  lineHeight: number;
}

export interface ImageElement extends BaseElement {
  type: "image";
  assetId: string;
}

/** Arbitrary vector path. `d` is in a local coordinate space of viewBoxW x viewBoxH. */
export interface PathElement extends BaseElement {
  type: "path";
  d: string;
  viewBoxW: number;
  viewBoxH: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

export type PatternSpec =
  | { kind: "lines"; spacing: number; firstOffset?: number }
  | { kind: "dots"; spacing: number; radius: number }
  | { kind: "grid"; spacing: number; majorEvery?: number }
  | { kind: "handwriting"; rowHeight: number; gap: number }
  | { kind: "staff"; staves: number; lineGap: number };

/** Procedural element (ruled lines, dot grid, ...) expanded at render time. */
export interface PatternElement extends BaseElement {
  type: "pattern";
  pattern: PatternSpec;
  stroke: string;
  strokeWidth: number;
}

export type Element =
  | RectElement
  | EllipseElement
  | LineElement
  | TextElement
  | ImageElement
  | PathElement
  | PatternElement;

export type ElementType = Element["type"];

export interface GeneratorRecord {
  kind: string;
  seed?: number;
  params?: Record<string, unknown>;
}

export interface Page {
  id: string;
  label?: string;
  elements: Element[];
  /** Hide the automatic page number on this page. */
  hideNumber?: boolean;
  generator?: GeneratorRecord;
  /** Interior section this page was generated for. */
  sectionId?: string;
}

/**
 * A generated part of the interior (front matter, a puzzle section, answer
 * keys…). Keeping the config lets a section be regenerated or resized later.
 */
export interface InteriorSection {
  id: string;
  label: string;
  role: "front" | "body" | "back";
  config: GeneratorConfig;
}

export interface PageNumberSettings {
  enabled: boolean;
  fontFamily: string;
  fontSize: number;
  /** First 1-based page that shows a number. */
  startAt: number;
}

export interface Interior {
  pages: Page[];
  sections: InteriorSection[];
  pageNumbers: PageNumberSettings;
}

export interface Cover {
  background: string;
  elements: Element[];
  /** "kdp": KDP prints the barcode, so its area must stay clear. */
  barcode: "kdp" | "own";
  templateId?: string;
}

export type AiDisclosureLevel = "none" | "some" | "most";

export interface AiDisclosure {
  text: AiDisclosureLevel;
  images: AiDisclosureLevel;
  translation: AiDisclosureLevel;
  /** User confirmed the disclosure answers. */
  confirmed: boolean;
}

export interface ListingMetadata {
  title: string;
  subtitle: string;
  author: string;
  series: string;
  edition: string;
  description: string;
  keywords: string[];
  categories: string[];
  language: string;
  listPriceUsd: number;
  isbn: { kind: "none" | "kdp-free" | "own"; value: string };
  adultContent: boolean;
  aiDisclosure: AiDisclosure;
}

export interface Brief {
  topic: string;
  audience: string;
  notes: string;
  angle: string;
  titleIdeas: string[];
  keywordIdeas: string[];
  interiorPlan: string;
  coverDirection: string;
  risks: string[];
}

export interface AssetLicense {
  /** SPDX id, CC id, or a free-form statement. */
  license: string;
  author: string;
  source: string;
  commercialUse: boolean;
  attribution?: string;
}

export interface Asset {
  id: string;
  name: string;
  mime: "image/png" | "image/jpeg";
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  origin: ArtifactOrigin;
  license: AssetLicense;
  contentHash: string;
  createdAt: string;
}

export interface ModelRun {
  id: string;
  at: string;
  provider: string;
  model: string;
  task: string;
  promptHash: string;
  /** What the run produced, e.g. "listing.description", "page:abc". */
  outputs: string[];
}

export interface ReviewFinding {
  /** What the finding is about: a listing field, "cover", or an image label such as "Page 12". */
  target: string;
  severity: "high" | "medium" | "low";
  issue: string;
  suggestion: string;
}

/** A stored model review. Rule-based checks are recomputed live and not stored. */
export interface StoredReview {
  at: string;
  provider: string;
  model: string;
  score: number;
  summary: string;
  findings: ReviewFinding[];
}

export interface ProjectReviews {
  listing?: StoredReview & {
    /** The critic's revised listing, offered for one-click apply. */
    revised?: { title: string; subtitle: string; description: string; keywords: string[]; categories: string[] };
  };
  visual?: StoredReview & { thumbnailReadable: boolean; images: string[] };
}

export interface Project {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bookType: BookType;
  spec: PrintSpec;
  brief: Brief;
  interior: Interior;
  cover: Cover;
  metadata: ListingMetadata;
  assets: Asset[];
  modelRuns: ModelRun[];
  /** Latest model reviews of the listing and the rendered book (optional; added in Phase 2, no migration needed). */
  reviews?: ProjectReviews;
}

export function isLowContent(bookType: BookType): boolean {
  // KDP: notebooks, journals, planners and log books are low-content.
  // Puzzle and coloring books are generally NOT low-content.
  return bookType === "notebook" || bookType === "journal" || bookType === "planner" || bookType === "log-book";
}

export const BOOK_TYPES: { id: BookType; label: string }[] = [
  { id: "notebook", label: "Notebook" },
  { id: "journal", label: "Journal" },
  { id: "planner", label: "Planner" },
  { id: "log-book", label: "Log book" },
  { id: "puzzle", label: "Puzzle book" },
  { id: "coloring", label: "Coloring book" },
  { id: "activity", label: "Activity book" },
  { id: "other", label: "Other" },
];
