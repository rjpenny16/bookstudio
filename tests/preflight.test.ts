import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { createProject } from "@/lib/schema/factory";
import { runPreflight } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { text } from "@/lib/schema/elements";
import { coverGeometry } from "@/lib/kdp/geometry";
import { cleanKeywords, findProhibited, validateListing } from "@/lib/metadata/validate";
import type { Project } from "@/lib/schema/project";

const status = (p: Project, id: string) => runPreflight(p).checks.find((c) => c.id === id)!;

function base(): Project {
  return createProject({ name: "Morning Pages", bookType: "journal", trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "A. Writer" });
}

describe("preflight", () => {
  it("passes geometry checks for a freshly generated book", () => {
    const p = base();
    for (const id of ["trim", "page-count", "interior-margins", "fonts", "cover-safe", "spine", "barcode", "blank-pages"]) {
      expect(status(p, id).status, id).not.toBe("fail");
    }
    expect(status(p, "interior-margins").status).toBe("pass");
  });

  it("flags text in the gutter and fixes it", () => {
    const bad = produce(base(), (d) => {
      d.interior.pages[0].elements.push(text({ x: 2, y: 100, width: 120, text: "too close" }));
    });
    expect(status(bad, "interior-margins").status).toBe("fail");
    const fixed = applyFix(bad, "move-into-safe");
    expect(status(fixed, "interior-margins").status).toBe("pass");
  });

  it("rejects spine text under 80 pages and removes it", () => {
    const p = produce(base(), (d) => {
      d.interior.pages.splice(60);
    });
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const withSpine = produce(p, (d) => {
      d.cover.elements.push(text({ x: cg.spineBox.x, y: cg.spineBox.y + 50, width: cg.spineBox.width, text: "X", fontSize: 6 }));
    });
    expect(status(withSpine, "spine").status).toBe("fail");
    expect(status(applyFix(withSpine, "remove-spine-text"), "spine").status).toBe("pass");
  });

  it("keeps the barcode area clear", () => {
    const p = base();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const bad = produce(p, (d) => {
      d.cover.elements.push(text({ x: cg.barcode.x + 10, y: cg.barcode.y + 10, width: 80, text: "blocked" }));
    });
    expect(status(bad, "barcode").status).toBe("fail");
    expect(status(applyFix(bad, "clear-barcode"), "barcode").status).toBe("pass");
  });

  it("pads odd and too-short books and keeps the front cover anchored", () => {
    const p = produce(base(), (d) => {
      d.interior.pages.splice(23);
    });
    expect(status(p, "page-count").status).toBe("fail");
    const fixed = applyFix(p, "pad-min");
    expect(fixed.interior.pages.length).toBe(24);
    expect(status(fixed, "page-count").status).toBe("pass");
    const before = coverGeometry(p.spec, 23);
    const after = coverGeometry(fixed.spec, 24);
    const title = (q: Project) => q.cover.elements.find((e) => e.name === "Title")!;
    expect(title(fixed).x - title(p).x).toBeCloseTo(after.front.x - before.front.x, 4);
  });

  it("requires AI disclosure when AI text is present", () => {
    const p = produce(base(), (d) => {
      d.interior.pages[1].elements.push({ ...text({ x: 60, y: 60, width: 100, text: "AI prompt" }), provenance: { origin: "ai-generated", runId: "run_1" } });
      d.metadata.aiDisclosure.confirmed = true;
    });
    expect(status(p, "ai-disclosure").status).toBe("fail");
    const fixed = applyFix(p, "suggest-ai-disclosure");
    expect(fixed.metadata.aiDisclosure.text).toBe("some");
    expect(status(fixed, "ai-disclosure").status).toBe("pass");
  });

  it("rejects free KDP ISBN for low-content books", () => {
    const p = produce(base(), (d) => {
      d.metadata.isbn.kind = "kdp-free";
    });
    expect(status(p, "isbn").status).toBe("fail");
  });
});

describe("listing validation", () => {
  it("finds prohibited terms on word boundaries", () => {
    expect(findProhibited("Free bestseller journal")).toEqual(expect.arrayContaining(["free", "bestseller"]));
    expect(findProhibited("freedom journal")).toEqual([]);
  });

  it("cleans keywords to KDP limits", () => {
    const out = cleanKeywords(["gratitude journal for women", "free gift", "a".repeat(60), "Gratitude Journal for Women", "1", "2", "3", "4", "5", "6"]);
    expect(out.length).toBe(7);
    expect(out).not.toContain("free gift");
    expect(out.every((k) => k.length <= 50)).toBe(true);
  });

  it("validates required fields", () => {
    const v = validateListing({ ...base().metadata, title: "", description: "" });
    expect(v.errors).toEqual(expect.arrayContaining(["Title is required.", "Description is required."]));
  });
});
