import { describe, expect, it } from "vitest";
import type { Check, PreflightReport } from "@/lib/preflight";
import { exportChecklist } from "@/lib/quality/exportChecklist";

const check = (id: string, status: Check["status"]): Check => ({ id, title: id, status, summary: "", issues: [] }) as unknown as Check;
const report = (checks: Check[]): PreflightReport => ({ rulesVersion: "t", checkedAt: "", checks, passed: checks.filter((c) => c.status === "pass").length, total: checks.length, blocking: checks.filter((c) => c.status === "fail").length });

describe("export checklist", () => {
  const clean = report([check("trim", "pass"), check("ai-disclosure", "fail")]);

  it("points at the first open step, in working order", () => {
    const c = exportChecklist({ report: report([check("margins", "fail"), check("trim", "pass")]), listingErrors: 1, disclosureConfirmed: false, approved: false, fixes: 0 });
    expect(c.items.map((i) => i.done)).toEqual([false, false, false, false]);
    expect(c.next?.id).toBe("preflight");
    expect(c.next?.detail).toBe("1 blocking issue");
    expect(c.next?.target).toBe("preflight");
  });

  it("doesn't count the unconfirmed disclosure as a preflight problem; it has its own step", () => {
    const c = exportChecklist({ report: clean, listingErrors: 0, disclosureConfirmed: false, approved: false, fixes: 2 });
    expect(c.items.find((i) => i.id === "preflight")?.done).toBe(true);
    expect(c.next?.id).toBe("disclosure");
    expect(c.next?.action).toBe("Confirm the AI disclosure");
    expect(c.fixes).toBe(2);
  });

  it("asks for the final approval last, then has nothing left", () => {
    expect(exportChecklist({ report: clean, listingErrors: 0, disclosureConfirmed: true, approved: false, fixes: 0 }).next?.id).toBe("approve");
    const done = exportChecklist({ report: clean, listingErrors: 0, disclosureConfirmed: true, approved: true, fixes: 0 });
    expect(done.next).toBeNull();
    expect(done.items.every((i) => i.done)).toBe(true);
  });

  it("sends listing errors to the listing", () => {
    const c = exportChecklist({ report: clean, listingErrors: 2, disclosureConfirmed: true, approved: true, fixes: 0 });
    expect(c.next).toMatchObject({ id: "listing", target: "listing", detail: "2 errors KDP would reject" });
  });
});
