import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createProject } from "@/lib/schema/factory";
import { renderCoverPdf, renderInteriorPdf } from "@/lib/render/pdf";
import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import { generatePages } from "@/lib/generators/pages";
import { nodeFontLoader } from "./helpers";

describe("PDF rendering", () => {
  it("renders a KDP-sized interior with embedded fonts", async () => {
    const p = createProject({ name: "Dot Grid Notebook", bookType: "notebook", trimId: "8.5x11", paper: "white", ink: "black", bleed: true, author: "Me",
      interior: [{ kind: "title-page", title: "Dot Grid", subtitle: "", author: "Me" }, { kind: "dot-grid", count: 119, spacingIn: 0.25 }] });
    const bytes = await renderInteriorPdf(p, { loadFont: nodeFontLoader });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(120);
    const g = interiorGeometry(p.spec, 120);
    const { width, height } = doc.getPage(5).getSize();
    expect(width).toBeCloseTo(g.pageW, 3);
    expect(height).toBeCloseTo(g.pageH, 3);
    const raw = Buffer.from(bytes).toString("latin1");
    expect(raw).toContain("/FontFile2");
    // Pattern pages are deduplicated into a shared XObject, keeping the file small.
    expect(bytes.length).toBeLessThan(3_000_000);
  });

  it("renders puzzle pages and a cover", async () => {
    const p = createProject({ name: "Sudoku", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, author: "Me",
      interior: [{ kind: "sudoku", count: 8, difficulty: "easy", perPage: 2, solutions: true, seed: 5 }, { kind: "maze", count: 4, difficulty: "easy", solutions: true, seed: 2 }, { kind: "blank", count: 10 }] });
    const interior = await PDFDocument.load(await renderInteriorPdf(p, { loadFont: nodeFontLoader }));
    expect(interior.getPageCount()).toBe(p.interior.pages.length);
    const cover = await PDFDocument.load(await renderCoverPdf(p, { loadFont: nodeFontLoader }));
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    expect(cover.getPage(0).getSize().width).toBeCloseTo(cg.width, 3);
    expect(cover.getPage(0).getSize().height).toBeCloseTo(cg.height, 3);
  });

  it("generates every generator kind", () => {
    const p = createProject({ name: "x", bookType: "other", trimId: "6x9", paper: "white", ink: "black", bleed: false });
    const kinds = ["lined", "graph", "handwriting", "music", "gratitude", "daily-planner", "habit-tracker", "log", "belongs-to"] as const;
    for (const kind of kinds) {
      const pages = generatePages({ kind, count: 2, spacingIn: 0.3, header: true, majorEvery: 4, rowHeightIn: 0.75, staves: 8, habits: 10, title: "Log", columns: ["A", "B"], rows: 20 } as never, { spec: p.spec, pageCountHint: 120 });
      expect(pages.length, kind).toBeGreaterThan(0);
    }
  });
});
