import type { FormatEdition, FormatKind, KdpStatus, ListingMetadata, Project } from "./project";

export const FORMAT_KINDS: FormatKind[] = ["paperback", "hardcover", "ebook"];

export const FORMAT_LABEL: Record<FormatKind, string> = { paperback: "Paperback", hardcover: "Hardcover", ebook: "Kindle eBook" };

export const STATUS_LABEL: Record<KdpStatus, string> = {
  "not-started": "Not scheduled",
  planned: "Planned",
  created: "Created on KDP",
  submitted: "Submitted",
  live: "Live",
};

/** Formats BookStudio can build files for today. The others can still be planned and tracked. */
export const EXPORTABLE: Record<FormatKind, boolean> = { paperback: true, hardcover: true, ebook: false };

export function defaultEdition(kind: FormatKind): FormatEdition {
  return kind === "paperback" ? { kind, enabled: true, kdp: { status: "not-started" } } : { kind, enabled: false, isbn: { kind: "none", value: "" }, kdp: { status: "not-started" } };
}

export function defaultFormats(): FormatEdition[] {
  return FORMAT_KINDS.map(defaultEdition);
}

/** The edition of one format (a disabled default when the project has none stored). */
export function editionOf(p: Pick<Project, "formats">, kind: FormatKind): FormatEdition {
  return p.formats?.find((f) => f.kind === kind) ?? defaultEdition(kind);
}

/** The stored edition of one format, added when missing. For use inside an immer recipe. */
export function editionDraft(p: Project, kind: FormatKind): FormatEdition {
  p.formats ??= defaultFormats();
  let e = p.formats.find((f) => f.kind === kind);
  if (!e) {
    e = defaultEdition(kind);
    p.formats.push(e);
  }
  return e;
}

export const enabledFormats = (p: Pick<Project, "formats">) => FORMAT_KINDS.filter((k) => editionOf(p, k).enabled);

export function formatIsbn(p: Pick<Project, "formats" | "metadata">, kind: FormatKind): ListingMetadata["isbn"] {
  return kind === "paperback" ? p.metadata.isbn : (editionOf(p, kind).isbn ?? { kind: "none", value: "" });
}

export function formatPrice(p: Pick<Project, "formats" | "metadata">, kind: FormatKind): number | null {
  return kind === "paperback" ? p.metadata.listPriceUsd : (editionOf(p, kind).listPriceUsd ?? null);
}

export function formatAsin(p: Pick<Project, "formats" | "metadata">, kind: FormatKind): string | undefined {
  return kind === "paperback" ? p.metadata.asin : editionOf(p, kind).asin;
}

/** A KDP step the author records by hand. */
export type KdpStep = "created" | "submitted" | "live";

/** Record a KDP step on an edition (mutates it). Later steps imply the earlier ones happened. */
export function recordStep(e: FormatEdition, step: KdpStep, at = new Date().toISOString()): void {
  e.kdp.createdAt ??= at;
  if (step !== "created") e.kdp.submittedAt ??= at;
  e.kdp.status = step;
}

/** Undo the KDP steps recorded on an edition, back to planned or not started (mutates it). */
export function clearSteps(e: FormatEdition): void {
  delete e.kdp.createdAt;
  delete e.kdp.submittedAt;
  e.kdp.status = e.kdp.plannedWeek ? "planned" : "not-started";
}

/** Formats for a copy of a book: a copy is a new KDP title, so its KDP history and ASINs are cleared. */
export function freshFormats(formats: FormatEdition[] | undefined): FormatEdition[] {
  return (formats ?? defaultFormats()).map((f) => {
    const { asin: _asin, ...rest } = f;
    void _asin;
    return { ...rest, kdp: { status: "not-started" } };
  });
}
