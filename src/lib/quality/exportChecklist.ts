import type { PreflightReport } from "@/lib/preflight";

/**
 * What still stands between a draft and an upload package, in the order to do
 * it. Review & Publish shows the list and one button for the next step, so the
 * publisher never has to work out from the scorecard what to do next.
 */

export type ChecklistTarget = "preflight" | "listing" | "disclosure" | "publish";

export interface ChecklistItem {
  id: "preflight" | "listing" | "disclosure" | "approve";
  label: string;
  /** What to do, for the "Next" button ("Confirm the AI disclosure"). */
  action: string;
  done: boolean;
  /** Why it isn't done yet, in a few words. */
  detail: string;
  target: ChecklistTarget;
}

export interface ExportChecklist {
  items: ChecklistItem[];
  /** First item still open, or null when the package can be exported. */
  next: ChecklistItem | null;
  /** Optional improvements: one-click fixes for preflight warnings. */
  fixes: number;
}

export function exportChecklist(input: { report: PreflightReport; listingErrors: number; disclosureConfirmed: boolean; approved: boolean; fixes: number }): ExportChecklist {
  const { report, listingErrors } = input;
  // The disclosure has its own item, so the preflight item counts everything else.
  const blocking = report.checks.filter((c) => c.status === "fail" && c.id !== "ai-disclosure").length;
  const items: ChecklistItem[] = [
    {
      id: "preflight",
      label: "KDP preflight",
      action: "Fix the blocking preflight issues",
      done: blocking === 0,
      detail: blocking ? `${blocking} blocking issue${blocking > 1 ? "s" : ""}` : `${report.passed}/${report.total} checks passed`,
      target: "preflight",
    },
    {
      id: "listing",
      label: "Listing",
      action: "Fix the listing errors",
      done: listingErrors === 0,
      detail: listingErrors ? `${listingErrors} error${listingErrors > 1 ? "s" : ""} KDP would reject` : "Title, description and keywords are within KDP's limits",
      target: "listing",
    },
    {
      id: "disclosure",
      label: "AI disclosure",
      action: "Confirm the AI disclosure",
      done: input.disclosureConfirmed,
      detail: input.disclosureConfirmed ? "Confirmed" : "KDP asks about AI-generated text and images",
      target: "disclosure",
    },
    {
      id: "approve",
      label: "Final approval",
      action: "Approve the final book",
      done: input.approved,
      detail: input.approved ? "Approved" : "Look over the cover, pages and listing, then tick the box",
      target: "publish",
    },
  ];
  return { items, next: items.find((i) => !i.done) ?? null, fixes: input.fixes };
}
