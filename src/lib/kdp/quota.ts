/**
 * Weekly KDP title quota: how many titles each format has created and submitted this
 * week, and a planner that spreads the books waiting to go out across future weeks.
 *
 * Weeks are keyed by the date their allowance starts (Sunday 00:00 UTC) as YYYY-MM-DD.
 * Pure functions of the editions passed in; the caller loads them from storage.
 */

import type { FormatEdition, FormatKind } from "@/lib/schema/project";
import { FORMAT_KINDS } from "@/lib/schema/formats";
import { TITLE_LIMITS } from "./limits";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** One format edition of one book, as the planner sees it. */
export interface EditionRef {
  projectId: string;
  title: string;
  edition: Pick<FormatEdition, "kind" | "enabled" | "kdp">;
}

export interface FormatUsage {
  /** Titles created on KDP this week. */
  created: number;
  /** Titles first submitted this week. */
  submitted: number;
  /** Titles planned for this week and not created yet. */
  planned: number;
}

export type WeekUsage = Record<FormatKind, FormatUsage>;

type DateLike = Date | string | number;

/** Start of the KDP week (Sunday 00:00 UTC) that contains `d`. */
export function weekStartUtc(d: DateLike): Date {
  const t = new Date(d);
  const back = (t.getUTCDay() - TITLE_LIMITS.resetDayUtc + 7) % 7;
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - back));
}

export const weekKey = (d: DateLike): string => weekStartUtc(d).toISOString().slice(0, 10);

export const addWeeks = (key: string, n: number): string => new Date(Date.parse(`${key}T00:00:00Z`) + n * WEEK_MS).toISOString().slice(0, 10);

/** When this week's allowance resets. */
export const nextResetUtc = (now: DateLike = Date.now()): Date => new Date(weekStartUtc(now).getTime() + WEEK_MS);

const emptyUsage = (): WeekUsage => Object.fromEntries(FORMAT_KINDS.map((k) => [k, { created: 0, submitted: 0, planned: 0 }])) as WeekUsage;

/** Created, submitted and planned counts per format for one week. */
export function usage(refs: EditionRef[], week: string): WeekUsage {
  const u = emptyUsage();
  for (const { edition: e } of refs) {
    const f = u[e.kind];
    if (!f) continue;
    if (e.kdp.createdAt && weekKey(e.kdp.createdAt) === week) f.created++;
    if (e.kdp.submittedAt && weekKey(e.kdp.submittedAt) === week) f.submitted++;
    if (e.enabled && e.kdp.status === "planned" && e.kdp.plannedWeek === week) f.planned++;
  }
  return u;
}

/** What a format has left this week on KDP itself (planned books not counted). */
export function remaining(f: FormatUsage): { creations: number; submissions: number } {
  return { creations: Math.max(0, TITLE_LIMITS.creationsPerFormatPerWeek - f.created), submissions: Math.max(0, TITLE_LIMITS.submissionsPerFormatPerWeek - f.submitted) };
}

/** Creation slots a week has free for planning: the limit minus what was created and what is planned. */
export const openSlots = (f: FormatUsage): number => Math.max(0, TITLE_LIMITS.creationsPerFormatPerWeek - f.created - f.planned);

/** A planned edition whose week has passed without it being created. */
export const isOverdue = (e: EditionRef["edition"], now: DateLike = Date.now()): boolean => e.enabled && e.kdp.status === "planned" && !!e.kdp.plannedWeek && e.kdp.plannedWeek < weekKey(now);

/** An enabled edition waiting for a week: never scheduled, or its planned week went by. */
export const isBacklog = (e: EditionRef["edition"], now: DateLike = Date.now()): boolean => e.enabled && (e.kdp.status === "not-started" || isOverdue(e, now));

/** The first week, from this one on, with a free creation slot for a format. */
export function nextOpenWeek(refs: EditionRef[], kind: FormatKind, now: DateLike = Date.now()): string {
  let w = weekKey(now);
  for (let i = 0; i < 520; i++, w = addWeeks(w, 1)) if (openSlots(usage(refs, w)[kind]) > 0) return w;
  return w;
}

export interface Assignment {
  projectId: string;
  kind: FormatKind;
  week: string;
}

/**
 * Plan every backlog edition into the earliest week with a free slot for its format.
 * Books are taken in the order given (put the readiest first). Each format has its own
 * allowance, so a book's formats usually land in the same week and link on Amazon sooner.
 */
export function autoSchedule(refs: EditionRef[], now: DateLike = Date.now()): Assignment[] {
  const used = new Map<string, number>();
  const slot = (week: string, kind: FormatKind) => `${week}|${kind}`;
  const bump = (week: string, kind: FormatKind) => used.set(slot(week, kind), (used.get(slot(week, kind)) ?? 0) + 1);
  const backlog: EditionRef[] = [];
  for (const r of refs) {
    const e = r.edition;
    if (isBacklog(e, now)) backlog.push(r);
    else if (e.kdp.createdAt) bump(weekKey(e.kdp.createdAt), e.kind);
    else if (e.enabled && e.kdp.status === "planned" && e.kdp.plannedWeek) bump(e.kdp.plannedWeek, e.kind);
  }
  const start = weekKey(now);
  const out: Assignment[] = [];
  for (const r of backlog) {
    let w = start;
    while ((used.get(slot(w, r.edition.kind)) ?? 0) >= TITLE_LIMITS.creationsPerFormatPerWeek) w = addWeeks(w, 1);
    bump(w, r.edition.kind);
    out.push({ projectId: r.projectId, kind: r.edition.kind, week: w });
  }
  return out;
}

/** Plain-text summary of this week's allowance, e.g. for a chat reply. */
export function quotaSummary(refs: EditionRef[], now: DateLike = Date.now(), labels: Record<FormatKind, string>): string {
  const u = usage(refs, weekKey(now));
  const hours = Math.ceil((nextResetUtc(now).getTime() - new Date(now).getTime()) / 3_600_000);
  const lines = FORMAT_KINDS.map((k) => {
    const r = remaining(u[k]);
    return `${labels[k]}: ${r.creations} of ${TITLE_LIMITS.creationsPerFormatPerWeek} creations and ${r.submissions} of ${TITLE_LIMITS.submissionsPerFormatPerWeek} submissions left`;
  });
  return [...lines, `Resets in ${hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} hours`} (Sunday 00:00 UTC).`].join("\n");
}

/** Planner refs from stored project summaries (summaries without formats yet are skipped). */
export function refsFromSummaries(summaries: { id: string; title: string; name: string; editions?: EditionRef["edition"][] }[]): EditionRef[] {
  return summaries.flatMap((s) => (s.editions ?? []).map((edition) => ({ projectId: s.id, title: s.title || s.name, edition })));
}

/** The editions that take a format's slots in a week: created that week, or planned for it and not created yet. */
export function weekItems(refs: EditionRef[], week: string, kind: FormatKind): EditionRef[] {
  return refs.filter(({ edition: e }) => e.kind === kind && (e.kdp.createdAt ? weekKey(e.kdp.createdAt) === week : e.enabled && e.kdp.status === "planned" && e.kdp.plannedWeek === week));
}

/** "Nov 1 to 7" or "Nov 29 to Dec 5" for a week key. */
export function weekLabel(key: string): string {
  const start = new Date(`${key}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${md(start)} to ${start.getUTCMonth() === end.getUTCMonth() ? end.getUTCDate() : md(end)}`;
}
