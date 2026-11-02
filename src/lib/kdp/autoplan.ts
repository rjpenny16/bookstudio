import { editionDraft, editionOf, FORMAT_LABEL } from "@/lib/schema/formats";
import { hardcoverSpec } from "@/lib/schema/hardcover";
import type { FormatKind, Project } from "@/lib/schema/project";
import { hardcoverAvailability, printCostUsd, royaltyUsd } from "./geometry";
import { charm } from "./pricing";
import { nextOpenWeek, weekLabel, type EditionRef } from "./quota";
import { MOSTLY_BLANK_TYPES } from "./rules-ebook";

/** Which formats a newly finished book is published in, and whether to plan them at all. */
export interface AutoPlanSettings {
  enabled: boolean;
  formats: FormatKind[];
}

export const AUTOPLAN_KEY = "autoplan:settings";
export const DEFAULT_AUTOPLAN: AutoPlanSettings = { enabled: true, formats: ["paperback", "hardcover", "ebook"] };

export interface AutoPlanResult {
  project: Project;
  planned: { kind: FormatKind; week: string }[];
  skipped: { kind: FormatKind; reason: string }[];
}

/** eBook prices to start from: a story reads as a real eBook, page-image eBooks sell for less. */
export const EBOOK_START_PRICE = { story: 4.99, pages: 2.99 } as const;

const hasStory = (p: Project) => p.bookType === "mystery" || p.interior.sections.some((s) => s.config.kind === "story");

/** Lowest .99 price at or above `min`. */
const ninetyNineAtLeast = (min: number) => Math.ceil(min + 0.01) - 0.01;

/** A hardcover price: the paperback price plus the extra printing cost, never below the hardcover minimum. */
export function hardcoverStartPrice(p: Project): number {
  const n = p.interior.pages.length;
  const spec = hardcoverSpec(p);
  const extra = printCostUsd(spec, n) - printCostUsd(p.spec, n);
  const price = charm(p.metadata.listPriceUsd + Math.max(0, extra));
  const min = royaltyUsd(spec, n, price).minListPrice;
  return Math.round((price >= min ? price : ninetyNineAtLeast(min)) * 100) / 100;
}

/**
 * Turn on the chosen formats for a newly finished book and plan each into the earliest
 * week with a free KDP slot for that format. Formats the book can't be (a trim KDP doesn't
 * print in hardcover, a mostly blank book as an eBook) are skipped with the reason.
 * Prices are filled in only where none is set, and editions already planned or on KDP
 * are left alone. Doesn't change its input.
 */
export function planNewBook(project: Project, others: EditionRef[], settings: AutoPlanSettings, now: Date | number | string = Date.now()): AutoPlanResult {
  if (!settings.enabled) return { project, planned: [], skipped: [] };
  const p = structuredClone(project);
  const planned: AutoPlanResult["planned"] = [];
  const skipped: AutoPlanResult["skipped"] = [];
  const refs = [...others];
  for (const kind of ["paperback", "hardcover", "ebook"] as const) {
    if (!settings.formats.includes(kind) && !editionOf(p, kind).enabled) continue;
    if (kind === "hardcover") {
      const can = hardcoverAvailability(p.spec, p.interior.pages.length);
      if (!can.ok) {
        skipped.push({ kind, reason: can.reasons[0] });
        continue;
      }
    }
    if (kind === "ebook" && MOSTLY_BLANK_TYPES.includes(p.bookType) && !editionOf(p, kind).enabled) {
      skipped.push({ kind, reason: "mostly blank books make poor eBooks" });
      continue;
    }
    const e = editionDraft(p, kind);
    e.enabled = true;
    if (kind === "hardcover" && e.listPriceUsd == null) e.listPriceUsd = hardcoverStartPrice(p);
    if (kind === "ebook" && e.listPriceUsd == null) e.listPriceUsd = hasStory(p) ? EBOOK_START_PRICE.story : EBOOK_START_PRICE.pages;
    if (e.kdp.status === "not-started") {
      e.kdp.plannedWeek = nextOpenWeek(refs, kind, now);
      e.kdp.status = "planned";
      planned.push({ kind, week: e.kdp.plannedWeek });
    }
    refs.push({ projectId: p.id, title: p.metadata.title, edition: { kind, enabled: true, kdp: { ...e.kdp } } });
  }
  return { project: p, planned, skipped };
}

/** "Paperback and Hardcover Nov 8 to 14, Kindle eBook Nov 15 to 21": formats grouped by week. */
export function plannedSummary(planned: AutoPlanResult["planned"]): string {
  const byWeek = new Map<string, string[]>();
  for (const { kind, week } of planned) byWeek.set(week, [...(byWeek.get(week) ?? []), FORMAT_LABEL[kind]]);
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, kinds]) => `${kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}` : kinds[0]} ${weekLabel(week)}`)
    .join(", ");
}
