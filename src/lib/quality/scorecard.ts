import type { Check, FixId, PreflightReport } from "@/lib/preflight";
import type { Project } from "@/lib/schema/project";
import type { Severity } from "./content";
import type { QualityReport } from "./index";

/**
 * The ready-to-publish scorecard: one number out of 100 that combines KDP
 * preflight, the rule-based quality checks, the latest model reviews and the
 * AI disclosure, with the one-click fixes that can raise it. Preflight
 * decides whether KDP accepts the files; the rest is what buyers notice.
 */

export type RowStatus = "pass" | "warn" | "fail";

export interface ScoreRow {
  id: "preflight" | "content" | "design" | "listing" | "disclosure";
  label: string;
  status: RowStatus;
  detail: string;
  points: number;
  max: number;
}

export interface Scorecard {
  score: number;
  rows: ScoreRow[];
  /** Deterministic preflight fixes available right now. */
  fixes: { fixId: FixId; label: string; check: string }[];
  /** No blocking preflight issue and the disclosure is confirmed. */
  ready: boolean;
}

const COST: Record<Severity, number> = { high: 6, medium: 2, low: 0.5 };

const status = (points: number, max: number): RowStatus => (points >= max * 0.8 ? "pass" : points >= max * 0.5 ? "warn" : "fail");
const deduct = (max: number, severities: Severity[]) => Math.max(0, max - severities.reduce((n, s) => n + COST[s], 0));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function counts(severities: Severity[]): string {
  const c = { high: 0, medium: 0, low: 0 };
  for (const s of severities) c[s]++;
  const parts = (["high", "medium", "low"] as const).filter((k) => c[k]).map((k) => `${c[k]} ${k}`);
  return parts.length ? parts.join(", ") : "no findings";
}

export function scorecard(project: Project, report: PreflightReport, quality: QualityReport): Scorecard {
  const rows: ScoreRow[] = [];
  const isDisclosure = (c: Check) => c.id === "ai-disclosure";

  // Preflight (35): what KDP will accept.
  const fails = report.checks.filter((c) => c.status === "fail" && !isDisclosure(c));
  const warns = report.checks.filter((c) => c.status === "warn" && !isDisclosure(c));
  const pf = Math.max(0, 35 - fails.length * 12 - warns.length * 3);
  rows.push({
    id: "preflight",
    label: "KDP preflight",
    status: fails.length ? "fail" : warns.length ? "warn" : "pass",
    detail: fails.length || warns.length ? [fails.length && `${plural(fails.length, "blocking issue")}: ${fails.map((c) => c.title).join(", ")}`, warns.length && plural(warns.length, "warning")].filter(Boolean).join("; ") : "Files meet KDP's print rules",
    points: pf,
    max: 35,
  });

  // Content (20): repeated or weak prompts, word lists, sayings.
  const content = quality.content.flatMap((s) => s.issues.map((i) => i.severity));
  const ct = deduct(20, content);
  rows.push({ id: "content", label: "Content", status: status(ct, 20), detail: content.length ? counts(content) : "No repeated or weak items", points: ct, max: 20 });

  // Cover & pages (20): rule checks, capped by the model's visual review when there is one.
  const design = quality.design.map((n) => n.severity);
  let dz = deduct(20, design);
  const visual = quality.reviews.visual;
  const seen = visual && visual.provider !== "offline" && visual.score > 0;
  if (seen) dz = Math.min(dz, (20 * visual.score) / 10);
  rows.push({
    id: "design",
    label: "Cover & pages",
    status: status(dz, 20),
    detail: `${counts(design)}${seen ? ` · visual review ${visual.score}/10${visual.thumbnailReadable ? "" : ", title hard to read as a thumbnail"}` : " · no visual review yet"}`,
    points: dz,
    max: 20,
  });

  // Listing (15): rule checks, capped by the model's critique when there is one.
  const listing = quality.listing.map((n) => n.severity);
  let ls = deduct(15, listing);
  const critique = quality.reviews.listing;
  const critiqued = critique && critique.provider !== "offline";
  if (critiqued) ls = Math.min(ls, (15 * critique.score) / 10);
  rows.push({ id: "listing", label: "Listing", status: status(ls, 15), detail: `${counts(listing)}${critiqued ? ` · critique ${critique.score}/10` : ""}`, points: ls, max: 15 });

  // Disclosure (10): KDP requires it, and only the publisher can confirm it.
  const confirmed = project.metadata.aiDisclosure.confirmed;
  rows.push({ id: "disclosure", label: "AI disclosure", status: confirmed ? "pass" : "fail", detail: confirmed ? "Confirmed" : "Needs your confirmation", points: confirmed ? 10 : 0, max: 10 });

  const fixes = report.checks.filter((c) => c.fix && c.status !== "pass").map((c) => ({ fixId: c.fix!.id, label: c.fix!.label, check: c.title }));
  const score = Math.round(rows.reduce((n, r) => n + r.points, 0));
  return { score, rows: rows.map((r) => ({ ...r, points: Math.round(r.points * 10) / 10 })), fixes, ready: fails.length === 0 && confirmed };
}
