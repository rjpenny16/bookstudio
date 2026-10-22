import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { inflateSync } from "node:zlib";
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

  it("draws letter spacing and outlined text", async () => {
    const p = createProject({ name: "Sudoku", bookType: "puzzle", trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "Me", interior: [{ kind: "blank", count: 24 }] });
    const title = p.cover.elements.find((e) => e.type === "text" && e.name === "Title")!;
    p.cover.elements = p.cover.elements.map((e) => (e.id === title.id && e.type === "text" ? { ...e, letterSpacing: 0.12, strokeColor: "#ffffff", strokeWidth: 2 } : e));
    const bytes = await renderCoverPdf(p, { loadFont: nodeFontLoader });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // Content streams are compressed; inflate them to find the text-state operators.
    const raw = Buffer.from(bytes).toString("latin1");
    const ops = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("\n");
    expect(ops).toMatch(/[\d.]+ Tc/);
    expect(ops).toMatch(/\b1 Tr\b/);
  });

  it("gives every drawn glyph a width, including substituted ones", async () => {
    // Lora swaps ":" between digits for colon.case; a glyph missing from /W prints 1em wide and runs into the gutter.
    const p = createProject({ name: "Times", bookType: "notebook", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, author: "Me", interior: [{ kind: "blank", count: 24 }] });
    p.interior.pages[0].elements = [{ id: "el_t", type: "text", text: "At 20:35, the office", x: 36, y: 36, width: 540, height: 20, rotation: 0, fontFamily: "Lora", bold: false, fontSize: 12, color: "#000000", align: "left", lineHeight: 1 }];
    const bytes = await renderInteriorPdf(p, { loadFont: nodeFontLoader, pageIndices: [0] });
    const raw = Buffer.from(bytes).toString("latin1");
    const ops = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
      .map((m) => {
        try {
          return inflateSync(Buffer.from(m[1], "latin1")).toString("latin1");
        } catch {
          return "";
        }
      })
      .join("\n");
    const used = [...ops.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].flatMap((m) => m[1].match(/.{4}/g)!.map((h) => parseInt(h, 16)));
    // Fewer glyphs than characters: "fi" in "office" is a ligature, another substituted glyph.
    expect(used.length).toBe("At 20:35, the office".length - 1);
    const widths = new Set<number>();
    for (const w of raw.matchAll(/\/W \[([\s\S]*?)\]\s*\]/g))
      for (const [, start, list] of `${w[1]}]`.matchAll(/(\d+)\s*\[([^\]]*)\]/g)) list.trim().split(/\s+/).forEach((_, k) => widths.add(Number(start) + k));
    expect(used.filter((id) => !widths.has(id))).toEqual([]);
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
