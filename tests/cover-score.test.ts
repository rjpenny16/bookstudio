import { describe, expect, it } from "vitest";
import { coverCrop } from "@/lib/cover/art";
import { ART_PALETTE_ID, paletteFromPixels } from "@/lib/cover/artPalette";
import { GENRES } from "@/lib/cover/genres";
import { coverMotif } from "@/lib/cover/inside";
import { splitTitle } from "@/lib/cover/lockup";
import { buildCover, PALETTES } from "@/lib/cover/templates";
import { genreFit, redesignTarget, variantSpecs } from "@/lib/cover/variants";
import { generateSudoku } from "@/lib/generators/sudoku";
import { coverGeometry } from "@/lib/kdp/geometry";
import { runPreflight } from "@/lib/preflight";
import { coverKey, edgeDensity, scoreCover, textContrast, type Raster } from "@/lib/quality/coverScore";
import { checkDesign } from "@/lib/quality/design";
import { createProject } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";
import { contrastRatio, TEXT_CONTRAST } from "@/lib/util/color";

/** A w x h raster filled by `paint(x, y)` -> [r, g, b]. */
function raster(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r, g, b, 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

const white = raster(100, 100, () => [255, 255, 255]);
const box = { x: 10, y: 10, width: 80, height: 30 };

describe("pixel contrast", () => {
  it("measures text against what is behind it", () => {
    expect(textContrast(white, box, "#000000")).toBeCloseTo(21, 0);
    expect(textContrast(white, box, "#eeeeee")).toBeLessThan(1.2);
  });

  it("catches a patch that matches the text even when most of the area is fine", () => {
    // A light stripe under a fifth of the title on an otherwise black background.
    const striped = raster(100, 100, (x) => (x >= 10 && x < 26 ? [250, 250, 250] : [0, 0, 0]));
    expect(textContrast(striped, box, "#ffffff")).toBeLessThan(1.5);
  });

  it("counts a busy background as clutter", () => {
    const busy = raster(100, 100, (x, y) => ((x + y) % 4 < 2 ? [0, 0, 0] : [255, 255, 255]));
    expect(edgeDensity(busy)).toBeGreaterThan(0.4);
    expect(edgeDensity(white)).toBe(0);
    expect(edgeDensity(busy, [{ x: 0, y: 0, width: 100, height: 100 }])).toBe(0);
  });

  it("scores legible, big, calm covers above poor ones", () => {
    const hero = { id: "t", hero: true, color: "#000000", box, large: true };
    const good = scoreCover({ background: white, texts: [hero], heroCapPx: 14, heroAreaShare: 0.2 });
    const faint = scoreCover({ background: white, texts: [{ ...hero, color: "#cccccc" }], heroCapPx: 14, heroAreaShare: 0.2 });
    const small = scoreCover({ background: white, texts: [hero], heroCapPx: 4, heroAreaShare: 0.2 });
    expect(good.score).toBe(100);
    expect(faint.score).toBeLessThan(good.score);
    expect(faint.parts.contrast).toBeLessThan(10);
    expect(small.parts.heroSize).toBeLessThan(5);
    expect(good.textContrast).toEqual([{ elementId: "t", ratio: 21 }]);
  });

  it("lets busy genres wear more decoration", () => {
    const dotted = raster(100, 100, (x, y) => (x % 10 === 0 || y % 10 === 0 ? [0, 0, 0] : [255, 255, 255]));
    const args = { background: dotted, texts: [], heroCapPx: 14, heroAreaShare: 0.2 };
    expect(scoreCover({ ...args, clutterOk: GENRES.kids.clutterOk }).parts.clutter).toBeGreaterThan(scoreCover({ ...args, clutterOk: GENRES.journal.clutterOk }).parts.clutter);
  });

  it("fingerprints a cover so stale analyses are ignored", () => {
    const p = book();
    const k = coverKey(p.cover);
    expect(coverKey({ ...p.cover, elements: p.cover.elements.map((e) => ({ ...e, provenance: { origin: "human" as const } })) })).toBe(k);
    expect(coverKey({ ...p.cover, elements: p.cover.elements.map((e, i) => (i === 0 ? { ...e, x: e.x + 5 } : e)) })).not.toBe(k);
  });
});

function book(over: Partial<Parameters<typeof createProject>[0]> = {}): Project {
  const p = createProject({
    name: "Large Print Sudoku Puzzles for Seniors",
    bookType: "puzzle",
    trimId: "8.5x11",
    paper: "white",
    ink: "black",
    bleed: false,
    author: "Ada Writer",
    interior: [
      { kind: "sudoku", count: 40, difficulty: "easy", perPage: 1, solutions: true, part: "puzzles", seed: 11 },
      { kind: "sudoku", count: 40, difficulty: "easy", perPage: 1, solutions: true, part: "solutions", seed: 11 },
    ],
    ...over,
  });
  p.metadata.title = p.name;
  p.brief.topic = "Large print sudoku";
  return p;
}

describe("design checks use the measured pixels", () => {
  it("reports a clash measured on the pixels while the cover is unchanged, and ignores it once stale", () => {
    const p = book();
    const title = p.cover.elements.find((e) => e.type === "text" && e.name === "Title")!;
    const analysis = { at: "", key: coverKey(p.cover), score: 50, parts: { contrast: 0, heroSize: 30, clutter: 15, balance: 5 }, minContrast: 1.1, textContrast: [{ elementId: title.id, ratio: 1.1 }] };
    const measured = { ...p, cover: { ...p.cover, analysis } };
    expect(checkDesign(measured).some((n) => n.elementId === title.id && n.severity === "high")).toBe(true);
    const moved = { ...measured, cover: { ...measured.cover, elements: measured.cover.elements.map((e) => (e.id === title.id ? { ...e, y: e.y + 1 } : e)) } };
    expect(checkDesign(moved).some((n) => n.elementId === title.id && n.severity === "high")).toBe(false);
  });
});

describe("puzzle motif", () => {
  it("is the book's own first puzzle, from the puzzle half of the section", () => {
    const p = book();
    const m = coverMotif(p)!;
    expect(m.kind).toBe("digits");
    expect(m.blocks).toBe(true);
    expect(m.cells).toEqual(generateSudoku(11, "easy").puzzle.map((v) => (v ? String(v) : "")));
  });

  it("uses word-search letters without sudoku blocks", () => {
    const p = book({ interior: [{ kind: "word-search", puzzles: [{ title: "Parks", words: ["canyon", "glacier", "geyser", "forest", "river", "valley"] }], size: 15, difficulty: "medium", solutions: false, seed: 4 }] });
    const m = coverMotif(p)!;
    expect(m).toMatchObject({ kind: "letters", blocks: false });
    expect(m.cells).toHaveLength(81);
    expect(m.cells.every((c) => /^[A-Z]$/.test(c))).toBe(true);
  });

  it("is drawn on puzzle covers without counting as front text", () => {
    const p = book({ trimId: "6x9" });
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const cover = buildCover("puzzle", { title: "Word Search", subtitle: "Puzzles about parks", author: "Ada", backText: "", palette: PALETTES[0], motif: coverMotif(p), type: GENRES.puzzle.type }, cg);
    expect(cover.elements.filter((e) => e.name === "Motif cell").length).toBeGreaterThan(20);
    const q = { ...p, cover: { ...p.cover, ...cover } };
    expect(checkDesign(q).filter((n) => n.area === "cover" && n.severity !== "low")).toEqual([]);
    expect(runPreflight(q).checks.find((c) => c.id === "cover-safe")?.status).not.toBe("fail");
  });
});

describe("variants", () => {
  const p = book();
  const base = { templateId: "puzzle", palette: PALETTES.find((x) => x.id === "newsprint")! };

  it("starts from the given design and tries the genre's best, without repeats", () => {
    const specs = variantSpecs(p, base);
    expect(specs[0]).toEqual(base);
    expect(specs.length).toBeLessThanOrEqual(6);
    expect(new Set(specs.map((s) => `${s.templateId}|${s.palette.id}`)).size).toBe(specs.length);
    for (const s of specs.slice(1)) expect([...GENRES["large-print"].templates, base.templateId]).toContain(s.templateId);
  });

  it("varies art layouts for art covers and includes the art's own palette", () => {
    const art = { ...PALETTES[0], id: ART_PALETTE_ID, name: "From the art" };
    const specs = variantSpecs(p, { templateId: "art-full-bleed", palette: PALETTES[0] }, [art]);
    expect(specs.every((s) => s.templateId.startsWith("art-"))).toBe(true);
    expect(specs.some((s) => s.palette.id === ART_PALETTE_ID)).toBe(true);
  });

  it("gives the genre's own templates and palettes a head start", () => {
    const g = GENRES["large-print"];
    expect(genreFit(g, { templateId: g.templates[0], palette: PALETTES.find((x) => x.id === g.palettes[0])! })).toBe(10);
    expect(genreFit(g, { templateId: "rainbow", palette: PALETTES.find((x) => x.id === "plum")! })).toBe(1);
  });

  it("redesigns into a different template after a poor review", () => {
    const q = { ...p, cover: { ...p.cover, templateId: "starburst", variants: [{ templateId: "starburst", paletteId: "royal", score: 90 }, { templateId: "starburst", paletteId: "sunny", score: 88 }, { templateId: "color-blocks", paletteId: "royal", score: 85 }] } };
    expect(redesignTarget(q)).toMatchObject({ templateId: "color-blocks", palette: { id: "royal" } });
    const alone = { ...p, cover: { ...p.cover, templateId: "starburst", paletteId: "royal", variants: undefined } };
    expect(redesignTarget(alone)).toMatchObject({ templateId: "starburst", palette: { id: "sunny" } });
  });
});

describe("art", () => {
  it("crops tall art at the chosen height and centers wide art", () => {
    expect(coverCrop(1000, 2000, 1, 0)).toEqual({ sx: 0, sy: 0, sw: 1000, sh: 1000 });
    expect(coverCrop(1000, 2000, 1, 1)).toEqual({ sx: 0, sy: 1000, sw: 1000, sh: 1000 });
    expect(coverCrop(1000, 2000, 1)).toEqual({ sx: 0, sy: 500, sw: 1000, sh: 1000 });
    expect(coverCrop(2000, 1000, 1, 0)).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000 });
  });

  it("takes a legible palette from the art's colors", () => {
    // Mostly deep teal with a band of bright orange.
    const img = raster(60, 60, (x, y) => (y < 12 ? [240, 120, 20] : [10, 70, 80]));
    const pal = paletteFromPixels(img.data)!;
    expect(pal.id).toBe(ART_PALETTE_ID);
    expect(contrastRatio(pal.bg, "#0a4650")!).toBeLessThan(1.2);
    expect(contrastRatio(pal.fg, pal.bg)!).toBeGreaterThanOrEqual(TEXT_CONTRAST);
    expect(contrastRatio(pal.accent, "#f07814")!).toBeLessThan(1.2);
  });
});

describe("title hero hint", () => {
  it("splits around the brief's hero words when they are in the title", () => {
    expect(splitTitle("Large Print Sudoku Puzzles for Seniors", "Sudoku Puzzles")).toEqual({ kicker: "Large Print", hero: "Sudoku Puzzles", support: "for Seniors" });
    expect(splitTitle("Sudoku: 200 Puzzles", "sudoku")).toEqual({ hero: "Sudoku", support: "200 Puzzles" });
  });

  it("falls back to the title's own shape when the hint doesn't fit", () => {
    expect(splitTitle("Daily Gratitude Journal", "Bird")).toEqual(splitTitle("Daily Gratitude Journal"));
    expect(splitTitle("One Two Three Four Five Six Sudoku", "Sudoku")).toEqual(splitTitle("One Two Three Four Five Six Sudoku"));
  });

  it("is passed through to the cover lockup", () => {
    const p = book();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const cover = buildCover("puzzle", { title: p.metadata.title, subtitle: "", author: "Ada", backText: "", palette: PALETTES[0], titleHero: "Sudoku Puzzles", type: GENRES.puzzle.type }, cg);
    const hero = cover.elements.find((e): e is TextElement => e.type === "text" && e.name === "Title")!;
    expect(hero.text).toBe("SUDOKU PUZZLES");
  });
});
