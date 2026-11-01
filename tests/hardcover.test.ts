import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { adaptCoverElements } from "@/lib/cover/adapt";
import { buildKdpPackage, metadataCsv, metadataJson, printFormats } from "@/lib/export/package";
import { boardExtrasFromKdpSize, boxContains, coverGeometry, coverSizeDiffIn, hardcoverAvailability, printCostUsd, royaltyUsd, spineWidthIn } from "@/lib/kdp/geometry";
import { HARDCOVER_COVER } from "@/lib/kdp/rules-hardcover";
import { runPreflight } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { renderCoverPdf } from "@/lib/render/pdf";
import { elementBounds } from "@/lib/schema/elements";
import { createProject } from "@/lib/schema/factory";
import { editionDraft } from "@/lib/schema/formats";
import { hardcoverProject, hardcoverSpec } from "@/lib/schema/hardcover";
import type { PrintSpec, Project } from "@/lib/schema/project";
import { paperbackSpec } from "@/lib/schema/spec";
import { nodeFontLoader } from "./helpers";

const hcSpec = (trim = "6x9", opts: Partial<PrintSpec> = {}): PrintSpec => ({ ...paperbackSpec(trim), ...opts, binding: "hardcover" });

const book = (pages = 120, bookType: Project["bookType"] = "puzzle"): Project =>
  createProject({ name: "Big Puzzle Book", bookType, trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "Ada", interior: [{ kind: "blank", count: pages }] });

const withHardcover = (p: Project, fn: (e: ReturnType<typeof editionDraft>) => void = () => {}): Project => {
  const q = structuredClone(p);
  const e = editionDraft(q, "hardcover");
  e.enabled = true;
  fn(e);
  return q;
};

describe("hardcover rules", () => {
  it("prices printing like KDP's example: 300 black pages = $5.65 + 300 x $0.012", () => {
    expect(printCostUsd(hcSpec(), 300)).toBe(9.25);
    const r = royaltyUsd(hcSpec(), 300, 24.99);
    expect(r.rate).toBe(0.6);
    expect(r.royalty).toBeCloseTo(24.99 * 0.6 - 9.25, 2);
  });

  it("adds the boards to the spine", () => {
    expect(spineWidthIn(hcSpec(), 200)).toBeCloseTo(200 * 0.002252 + HARDCOVER_COVER.spineBoardIn, 6);
    expect(spineWidthIn(paperbackSpec("6x9"), 200)).toBeCloseTo(200 * 0.002252, 6);
  });

  it("lays out a case-laminate cover: wrap, boards, spine and hinges", () => {
    const g = coverGeometry(hcSpec(), 200);
    const wrap = HARDCOVER_COVER.wrapIn * 72;
    const board = (6 + HARDCOVER_COVER.boardExtraWidthIn) * 72;
    expect(g.width).toBeCloseTo(wrap * 2 + board * 2 + g.spine, 3);
    expect(g.height).toBeCloseTo(wrap * 2 + (9 + HARDCOVER_COVER.boardExtraHeightIn) * 72, 3);
    expect(g.bleed).toBeCloseTo(wrap, 3);
    // The front safe area starts after the hinge; nothing safe overlaps either hinge.
    expect(g.frontSafe.x).toBeGreaterThanOrEqual(g.hingeFront!.x + g.hingeFront!.width);
    expect(g.backSafe.x + g.backSafe.width).toBeLessThanOrEqual(g.hingeBack!.x);
    expect(boxContains(g.back, g.barcode)).toBe(true);
  });

  it("can size the boards from KDP's cover calculator", () => {
    const spec = hcSpec();
    const kdp = { widthIn: 14.25, heightIn: 10.5, pages: 200 };
    expect(coverSizeDiffIn(spec, kdp)).toBeGreaterThan(0.02);
    const adjusted = { ...spec, coverAdjust: boardExtrasFromKdpSize(spec, kdp) };
    expect(coverSizeDiffIn(adjusted, kdp)).toBeLessThan(0.001);
  });

  it("says why a book can't be a hardcover", () => {
    expect(hardcoverAvailability(hcSpec(), 120).ok).toBe(true);
    expect(hardcoverAvailability(hcSpec("8.5x11"), 120).reasons[0]).toMatch(/isn't a KDP hardcover size/);
    expect(hardcoverAvailability(hcSpec("6x9", { ink: "standard-color" }), 120).reasons[0]).toMatch(/standard color/);
    expect(hardcoverAvailability(hcSpec(), 60).reasons[0]).toMatch(/at least 75 pages/);
    expect(hardcoverAvailability(hcSpec(), 600).reasons[0]).toMatch(/at most 550/);
  });
});

describe("hardcover cover from the paperback cover", () => {
  it("keeps text in the safe areas, off the hinge, and backgrounds edge to edge", () => {
    const p = book();
    const from = coverGeometry(p.spec, 120);
    const to = coverGeometry(hardcoverSpec(p), 120);
    const els = adaptCoverElements(p.cover.elements, from, to);
    expect(els).toHaveLength(p.cover.elements.length);
    for (const [i, el] of els.entries()) {
      const before = elementBounds(p.cover.elements[i]);
      const after = elementBounds(el);
      if (el.type === "text") {
        const inSafe = [to.backSafe, to.frontSafe, to.spineSafe].some((s) => boxContains(s, after, 0.5));
        expect(inSafe, el.name).toBe(true);
      }
      // Anything that covered the whole paperback cover covers the whole hardcover cover.
      if (before.x <= 0 && before.width >= from.width && el.type !== "text") {
        expect(after.x).toBeLessThanOrEqual(0.01);
        expect(after.x + after.width).toBeGreaterThanOrEqual(to.width - 0.01);
      }
    }
    const title = els.find((e) => e.type === "text" && e.name === "Title");
    if (title?.type === "text") expect(title.fontSize).toBeGreaterThan(0);
  });

  it("renders a hardcover cover PDF at the hardcover size", async () => {
    const hc = hardcoverProject(withHardcover(book()));
    const doc = await PDFDocument.load(await renderCoverPdf(hc, { loadFont: nodeFontLoader }));
    const g = coverGeometry(hc.spec, 120);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(g.width, 2);
    expect(doc.getPage(0).getSize().height).toBeCloseTo(g.height, 2);
  });
});

describe("hardcover preflight", () => {
  const find = (p: Project) => runPreflight(p).checks.find((c) => c.id === "hardcover");

  it("only runs when the hardcover is on", () => {
    expect(find(book())).toBeUndefined();
  });

  it("asks for the KDP cover size and a price, then checks the size and offers to adopt it", () => {
    let p = withHardcover(book());
    const c = find(p)!;
    expect(c.status).toBe("warn");
    expect(c.issues.map((i) => i.message).join(" ")).toMatch(/cover calculator/);
    p = withHardcover(p, (e) => {
      e.listPriceUsd = 19.99;
      e.isbn = { kind: "kdp-free", value: "" };
      e.coverCheck = { widthIn: 14.2, heightIn: 10.4, pages: 120 };
    });
    const bad = find(p)!;
    expect(bad.status).toBe("fail");
    expect(bad.fix?.id).toBe("adopt-kdp-cover-size");
    const fixed = applyFix(p, "adopt-kdp-cover-size");
    expect(find(fixed)!.status).toBe("pass");
    expect(coverGeometry(hardcoverSpec(fixed), 120).width / 72).toBeCloseTo(14.2, 3);
  });

  it("blocks a hardcover that reuses the paperback's ISBN, or can't exist", () => {
    const p = book();
    p.metadata.isbn = { kind: "own", value: "978-0-306-40615-7" };
    const same = withHardcover(p, (e) => (e.isbn = { kind: "own", value: "9780306406157" }));
    expect(find(same)!.issues.map((i) => i.message).join(" ")).toMatch(/paperback's ISBN/);
    expect(find(withHardcover(book(60)))!.status).toBe("fail");
  });
});

describe("hardcover in the package", () => {
  it("writes a metadata row and files for the hardcover", async () => {
    const p = withHardcover(book(), (e) => {
      e.listPriceUsd = 21.99;
      e.isbn = { kind: "kdp-free", value: "" };
    });
    expect(printFormats(p)).toEqual(["paperback", "hardcover"]);
    expect(printFormats(withHardcover(book(60)))).toEqual(["paperback"]);
    const m = metadataJson(p, "hardcover");
    expect(m).toMatchObject({ format: "hardcover", listPriceUsd: 21.99, isbn: { kind: "kdp-free" } });
    expect(m.pricing.printCostUsd).toBe(printCostUsd(hardcoverSpec(p), 120));
    expect(metadataJson(p).format).toBe("paperback");
    const csv = metadataCsv(p).trim().split("\n");
    expect(csv).toHaveLength(3);
    expect(csv[0].startsWith("format,title")).toBe(true);
    expect(csv[2].startsWith('"hardcover"')).toBe(true);

    const zip = await JSZip.loadAsync(await (await buildKdpPackage(p, { loadFont: nodeFontLoader })).arrayBuffer());
    for (const f of ["interior.pdf", "cover.pdf", "hardcover/interior.pdf", "hardcover/cover.pdf", "hardcover/metadata.json"]) expect(zip.file(f), f).not.toBeNull();
    expect(await zip.file("README.txt")!.async("string")).toMatch(/HARDCOVER/);
  }, 60_000);
});
