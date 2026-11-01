import { describe, expect, it } from "vitest";
import { decide } from "@/lib/inbox/commands";
import { TITLE_LIMITS } from "@/lib/kdp/limits";
import { addWeeks, autoSchedule, isBacklog, nextOpenWeek, nextResetUtc, openSlots, quotaSummary, remaining, usage, weekItems, weekKey, weekLabel, weekStartUtc, type EditionRef } from "@/lib/kdp/quota";
import { parseProjectFile } from "@/lib/export/package";
import { createProject } from "@/lib/schema/factory";
import { clearSteps, defaultEdition, editionDraft, editionOf, enabledFormats, FORMAT_LABEL, formatAsin, formatIsbn, formatPrice, freshFormats, recordStep } from "@/lib/schema/formats";
import { migrateProject } from "@/lib/schema/migrate";
import { SCHEMA_VERSION, type FormatEdition, type FormatKind, type KdpStatus } from "@/lib/schema/project";
import { paperbackSpec } from "@/lib/schema/spec";

const book = () => createProject({ name: "Test", bookType: "journal", trimId: "6x9", paper: "white", ink: "black", bleed: false });

describe("formats on a project", () => {
  it("new books are paperback only, with hardcover and eBook off", () => {
    const p = book();
    expect(p.formats.map((f) => [f.kind, f.enabled])).toEqual([
      ["paperback", true],
      ["hardcover", false],
      ["ebook", false],
    ]);
    expect(enabledFormats(p)).toEqual(["paperback"]);
  });

  it("the paperback reads ISBN, price and ASIN from the listing; other formats keep their own", () => {
    const p = book();
    p.metadata.isbn = { kind: "own", value: "9780000000001" };
    p.metadata.asin = "B000PAPER";
    const hc = editionDraft(p, "hardcover");
    hc.isbn = { kind: "kdp-free", value: "" };
    hc.listPriceUsd = 19.99;
    hc.asin = "B000HARD";
    expect(formatIsbn(p, "paperback").value).toBe("9780000000001");
    expect(formatPrice(p, "paperback")).toBe(p.metadata.listPriceUsd);
    expect(formatAsin(p, "paperback")).toBe("B000PAPER");
    expect(formatIsbn(p, "hardcover").kind).toBe("kdp-free");
    expect(formatPrice(p, "hardcover")).toBe(19.99);
    expect(formatPrice(p, "ebook")).toBeNull();
    expect(formatAsin(p, "hardcover")).toBe("B000HARD");
  });

  it("editionDraft adds a missing edition, editionOf never stores one", () => {
    const p = book();
    p.formats = p.formats.filter((f) => f.kind !== "ebook");
    expect(editionOf(p, "ebook").enabled).toBe(false);
    expect(p.formats).toHaveLength(2);
    editionDraft(p, "ebook").enabled = true;
    expect(p.formats).toHaveLength(3);
    expect(enabledFormats(p)).toEqual(["paperback", "ebook"]);
  });

  it("recording a step fills in the earlier ones; reset goes back to planned", () => {
    const e = defaultEdition("hardcover");
    e.kdp = { status: "planned", plannedWeek: "2026-11-01" };
    recordStep(e, "submitted", "2026-11-03T10:00:00Z");
    expect(e.kdp).toMatchObject({ status: "submitted", createdAt: "2026-11-03T10:00:00Z", submittedAt: "2026-11-03T10:00:00Z" });
    recordStep(e, "live", "2026-11-05T10:00:00Z");
    expect(e.kdp.status).toBe("live");
    expect(e.kdp.submittedAt).toBe("2026-11-03T10:00:00Z");
    clearSteps(e);
    expect(e.kdp).toEqual({ status: "planned", plannedWeek: "2026-11-01" });
  });

  it("a copy of a book is a new KDP title", () => {
    const p = book();
    const hc = editionDraft(p, "hardcover");
    hc.enabled = true;
    hc.asin = "B000HARD";
    hc.listPriceUsd = 21;
    recordStep(hc, "live");
    const copy = freshFormats(p.formats);
    const c = copy.find((f) => f.kind === "hardcover")!;
    expect(c).toMatchObject({ enabled: true, listPriceUsd: 21, kdp: { status: "not-started" } });
    expect(c.asin).toBeUndefined();
  });

  it("paperbackSpec falls back to the given trim", () => {
    expect(paperbackSpec("8.5x11")).toMatchObject({ binding: "paperback", trimId: "8.5x11", widthIn: 8.5, heightIn: 11, ink: "black" });
    expect(paperbackSpec("nope", {}, "8.5x11").trimId).toBe("8.5x11");
    expect(paperbackSpec("nope").trimId).toBe("6x9");
  });
});

describe("schema 1.2 migration", () => {
  it("adds formats to 1.1 projects, marking the paperback live when it has an ASIN", () => {
    const p = book();
    const { formats: _f, ...rest } = p;
    void _f;
    const old = { ...rest, schemaVersion: "1.1" } as unknown as typeof p;
    const up = migrateProject(old);
    expect(up.schemaVersion).toBe(SCHEMA_VERSION);
    expect(up.formats.map((f) => f.kind)).toEqual(["paperback", "hardcover", "ebook"]);
    expect(editionOf(up, "paperback").kdp.status).toBe("not-started");
    const live = migrateProject({ ...old, metadata: { ...old.metadata, asin: "B0TEST" } });
    expect(editionOf(live, "paperback").kdp.status).toBe("live");
    expect(parseProjectFile(JSON.stringify(old)).formats).toHaveLength(3);
  });

  it("leaves current projects alone and fills in a missing format", () => {
    const p = book();
    expect(migrateProject(p)).toBe(p);
    const partial = { ...p, schemaVersion: "1.1", formats: [{ ...defaultEdition("paperback"), kdp: { status: "created" as const, createdAt: "2026-11-02T00:00:00Z" } }] } as unknown as typeof p;
    const up = migrateProject(partial);
    expect(up.formats).toHaveLength(3);
    expect(editionOf(up, "paperback").kdp.status).toBe("created");
  });
});

const ref = (projectId: string, kind: FormatKind, kdp: Partial<FormatEdition["kdp"]> & { status: KdpStatus }, enabled = true): EditionRef => ({ projectId, title: projectId, edition: { kind, enabled, kdp } });

describe("KDP week", () => {
  it("starts Sunday 00:00 UTC", () => {
    expect(weekKey("2026-11-01T00:00:00Z")).toBe("2026-11-01"); // a Sunday
    expect(weekKey("2026-10-31T23:59:59Z")).toBe("2026-10-25"); // Saturday night is still last week
    expect(weekKey("2026-11-07T23:59:59Z")).toBe("2026-11-01");
    expect(weekKey("2026-11-08T00:00:00Z")).toBe("2026-11-08");
    // Local time zones don't matter: 8 pm Saturday in New York is already Sunday in UTC.
    expect(weekKey("2026-10-31T20:00:00-04:00")).toBe("2026-11-01");
    expect(weekStartUtc("2026-09-23T12:00:00Z").toISOString()).toBe("2026-09-20T00:00:00.000Z");
    expect(nextResetUtc("2026-11-04T12:00:00Z").toISOString()).toBe("2026-11-08T00:00:00.000Z");
  });

  it("adds weeks across month and year ends", () => {
    expect(addWeeks("2026-11-29", 1)).toBe("2026-12-06");
    expect(addWeeks("2026-12-27", 1)).toBe("2027-01-03");
    expect(weekLabel("2026-11-01")).toBe("Nov 1 to 7");
    expect(weekLabel("2026-11-29")).toBe("Nov 29 to Dec 5");
  });
});

describe("weekly quota", () => {
  const now = "2026-11-04T12:00:00Z";
  const week = "2026-11-01";

  it("counts creations and submissions per format, by the week they happened", () => {
    const refs = [
      ref("a", "paperback", { status: "submitted", createdAt: "2026-11-02T00:00:00Z", submittedAt: "2026-11-02T01:00:00Z" }),
      ref("b", "paperback", { status: "created", createdAt: "2026-10-30T00:00:00Z" }), // last week
      ref("b", "hardcover", { status: "planned", plannedWeek: week }),
      ref("c", "hardcover", { status: "planned", plannedWeek: week }, false), // turned off: not counted
      ref("d", "ebook", { status: "submitted", createdAt: "2026-10-28T00:00:00Z", submittedAt: "2026-11-03T00:00:00Z" }),
    ];
    const u = usage(refs, week);
    expect(u.paperback).toEqual({ created: 1, submitted: 1, planned: 0 });
    expect(u.hardcover).toEqual({ created: 0, submitted: 0, planned: 1 });
    expect(u.ebook).toEqual({ created: 0, submitted: 1, planned: 0 });
    expect(remaining(u.paperback)).toEqual({ creations: 1, submissions: 1 });
    expect(openSlots(u.hardcover)).toBe(1);
    expect(weekItems(refs, week, "paperback").map((r) => r.projectId)).toEqual(["a"]);
    expect(weekItems(refs, week, "hardcover").map((r) => r.projectId)).toEqual(["b"]);
    expect(quotaSummary(refs, now, FORMAT_LABEL)).toContain("Paperback: 1 of 2 creations and 1 of 2 submissions left");
  });

  it("finds the next week with a free slot", () => {
    const refs = [
      ref("a", "paperback", { status: "created", createdAt: "2026-11-02T00:00:00Z" }),
      ref("b", "paperback", { status: "planned", plannedWeek: week }),
      ref("c", "paperback", { status: "planned", plannedWeek: "2026-11-08" }),
      ref("d", "paperback", { status: "planned", plannedWeek: "2026-11-08" }),
    ];
    expect(nextOpenWeek(refs, "paperback", now)).toBe("2026-11-15");
    expect(nextOpenWeek(refs, "hardcover", now)).toBe(week);
  });

  it("plans the backlog with at most the weekly limit per format", () => {
    const refs: EditionRef[] = [ref("old", "paperback", { status: "created", createdAt: "2026-11-02T00:00:00Z" })];
    for (const id of ["p1", "p2", "p3", "p4"]) for (const k of ["paperback", "hardcover", "ebook"] as const) refs.push(ref(id, k, { status: "not-started" }));
    refs.push(ref("late", "ebook", { status: "planned", plannedWeek: "2026-10-18" })); // overdue: back in the backlog
    refs.push(ref("off", "hardcover", { status: "not-started" }, false));
    const plan = autoSchedule(refs, now);
    expect(plan).toHaveLength(13);
    expect(plan.some((a) => a.projectId === "off")).toBe(false);
    const per = new Map<string, number>();
    for (const a of plan) per.set(`${a.week}|${a.kind}`, (per.get(`${a.week}|${a.kind}`) ?? 0) + 1);
    // This week's paperback has one creation already, so it fits one more.
    expect(per.get(`${week}|paperback`)).toBe(1);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(TITLE_LIMITS.creationsPerFormatPerWeek);
    // Books go out in order, and a book's hardcover and eBook land in the same week.
    const at = (id: string, k: FormatKind) => plan.find((a) => a.projectId === id && a.kind === k)!.week;
    expect(at("p1", "hardcover")).toBe(week);
    expect(at("p1", "ebook")).toBe(week);
    expect(at("p3", "hardcover")).toBe("2026-11-08");
    expect(at("p4", "paperback")).toBe("2026-11-15");
    expect(at("late", "ebook")).toBe("2026-11-15");
    expect(isBacklog(refs.at(-2)!.edition, now)).toBe(true);
  });
});

describe("quota command", () => {
  it("answers quota, slots and limits", () => {
    const cfg = { ownerId: "1", channelId: "c" };
    for (const w of ["quota", "Slots", "limits"]) expect(decide({ authorId: "1", channelId: "c", isBot: false, content: w }, cfg).kind).toBe("quota");
  });
});
