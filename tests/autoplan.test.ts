import { describe, expect, it } from "vitest";
import { readyText } from "@/lib/inbox/commands";
import type { InboxItem } from "@/lib/inbox/state";
import { DEFAULT_AUTOPLAN, EBOOK_START_PRICE, hardcoverStartPrice, planNewBook, plannedSummary } from "@/lib/kdp/autoplan";
import { printCostUsd, royaltyUsd } from "@/lib/kdp/geometry";
import type { EditionRef } from "@/lib/kdp/quota";
import { createProject } from "@/lib/schema/factory";
import { editionDraft, editionOf } from "@/lib/schema/formats";
import { hardcoverSpec } from "@/lib/schema/hardcover";
import type { Project } from "@/lib/schema/project";

const now = "2026-11-04T12:00:00Z"; // week of Sunday Nov 1
const book = (opts: Partial<{ trimId: string; bookType: Project["bookType"]; pages: number }> = {}): Project =>
  createProject({ name: "Gratitude Journal", bookType: opts.bookType ?? "journal", trimId: opts.trimId ?? "6x9", paper: "white", ink: "black", bleed: false, interior: [{ kind: "lined", count: opts.pages ?? 120, spacingIn: 0.3125, header: false }] });

const created = (projectId: string, kind: EditionRef["edition"]["kind"]): EditionRef => ({ projectId, title: projectId, edition: { kind, enabled: true, kdp: { status: "created", createdAt: "2026-11-02T00:00:00Z" } } });

describe("planning a finished book", () => {
  it("turns on every format and plans them into this week when it's free", () => {
    const p = book();
    const r = planNewBook(p, [], DEFAULT_AUTOPLAN, now);
    expect(r.planned).toEqual([
      { kind: "paperback", week: "2026-11-01" },
      { kind: "hardcover", week: "2026-11-01" },
      { kind: "ebook", week: "2026-11-01" },
    ]);
    expect(r.skipped).toEqual([]);
    for (const k of ["paperback", "hardcover", "ebook"] as const) expect(editionOf(r.project, k)).toMatchObject({ enabled: true, kdp: { status: "planned", plannedWeek: "2026-11-01" } });
    // The input is untouched.
    expect(editionOf(p, "hardcover").enabled).toBe(false);
    expect(plannedSummary(r.planned)).toBe("Paperback, Hardcover and Kindle eBook Nov 1 to 7");
  });

  it("moves only the format whose week is full", () => {
    const r = planNewBook(book(), [created("a", "paperback"), created("b", "paperback")], DEFAULT_AUTOPLAN, now);
    expect(r.planned).toEqual([
      { kind: "paperback", week: "2026-11-08" },
      { kind: "hardcover", week: "2026-11-01" },
      { kind: "ebook", week: "2026-11-01" },
    ]);
    expect(plannedSummary(r.planned)).toBe("Hardcover and Kindle eBook Nov 1 to 7, Paperback Nov 8 to 14");
  });

  it("skips a hardcover the book can't be, and an eBook of a mostly blank notebook", () => {
    const letter = planNewBook(book({ trimId: "8.5x11" }), [], DEFAULT_AUTOPLAN, now);
    expect(letter.skipped).toEqual([{ kind: "hardcover", reason: expect.stringMatching(/isn't a KDP hardcover size/) }]);
    expect(editionOf(letter.project, "hardcover").enabled).toBe(false);
    const notebook = planNewBook(book({ bookType: "notebook" }), [], DEFAULT_AUTOPLAN, now);
    expect(notebook.skipped.map((s) => s.kind)).toEqual(["ebook"]);
    expect(notebook.planned.map((s) => s.kind)).toEqual(["paperback", "hardcover"]);
  });

  it("prices a new hardcover above its printing cost and a new eBook by kind; keeps prices already set", () => {
    const p = book();
    const r = planNewBook(p, [], DEFAULT_AUTOPLAN, now);
    const hc = editionOf(r.project, "hardcover").listPriceUsd!;
    expect(hc).toBe(hardcoverStartPrice(p));
    expect(hc.toFixed(2)).toMatch(/\.99$/);
    expect(royaltyUsd(hardcoverSpec(p), 120, hc).royalty).toBeGreaterThan(0);
    expect(hc).toBeGreaterThanOrEqual(p.metadata.listPriceUsd + printCostUsd(hardcoverSpec(p), 120) - printCostUsd(p.spec, 120) - 0.5);
    expect(editionOf(r.project, "ebook").listPriceUsd).toBe(EBOOK_START_PRICE.pages);
    const priced = structuredClone(p);
    editionDraft(priced, "hardcover").listPriceUsd = 24.5;
    expect(editionOf(planNewBook(priced, [], DEFAULT_AUTOPLAN, now).project, "hardcover").listPriceUsd).toBe(24.5);
  });

  it("leaves editions already planned or on KDP alone", () => {
    const p = book();
    const pb = editionDraft(p, "paperback");
    pb.kdp = { status: "created", createdAt: "2026-10-20T00:00:00Z" };
    const r = planNewBook(p, [], DEFAULT_AUTOPLAN, now);
    expect(editionOf(r.project, "paperback").kdp).toEqual({ status: "created", createdAt: "2026-10-20T00:00:00Z" });
    expect(r.planned.map((x) => x.kind)).toEqual(["hardcover", "ebook"]);
  });

  it("respects the settings", () => {
    expect(planNewBook(book(), [], { enabled: false, formats: ["paperback"] }, now).planned).toEqual([]);
    const only = planNewBook(book(), [], { enabled: true, formats: ["paperback"] }, now);
    expect(only.planned).toEqual([{ kind: "paperback", week: "2026-11-01" }]);
    expect(editionOf(only.project, "ebook").enabled).toBe(false);
  });
});

describe("phone reply", () => {
  it("says which weeks the book is planned for", () => {
    const item = { id: "1", status: "ready", text: "idea", result: { projectId: "prj_1", title: "Gratitude Journal", pages: 120, preflight: { passed: 12, total: 13, blocking: 0 }, planned: [{ kind: "paperback", week: "2026-11-01" }, { kind: "ebook", week: "2026-11-08" }] } } as unknown as InboxItem;
    expect(readyText(item, "http://x")).toContain("Planned for KDP: Paperback Nov 1 to 7, Kindle eBook Nov 8 to 14.");
    const noPlan = { ...item, result: { ...item.result!, planned: undefined } };
    expect(readyText(noPlan, "http://x")).not.toContain("Planned");
  });
});
