import { describe, expect, it } from "vitest";
import { PALETTE_CHOICES, TEMPLATE_CHOICES } from "@/lib/ai/tasks";
import { coverBadge, seriesName, seriesVolume } from "@/lib/cover/inside";
import { applyCoverTemplate, captureCoverTemplate, parseCoverTemplate } from "@/lib/cover/library";
import { restyleOffline } from "@/lib/cover/restyle";
import { buildCover, COVER_TEMPLATES, PALETTES, TEMPLATE_TAGS, type CoverInput } from "@/lib/cover/templates";
import { coverGeometry } from "@/lib/kdp/geometry";
import { checkDesign } from "@/lib/quality/design";
import { elementBounds } from "@/lib/schema/elements";
import { createProject } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";
import { shiftHue } from "@/lib/util/color";

function book(trimId: string, title: string, count = 120): Project {
  const p = createProject({ name: title, bookType: "puzzle", trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: [{ kind: "sudoku", count, difficulty: "easy", perPage: 1, solutions: true, seed: 1 }] });
  p.metadata.title = title;
  p.metadata.subtitle = "Easy to hard puzzles to sharpen your mind";
  return p;
}

const input = (palette = PALETTES[0], over: Partial<CoverInput> = {}): CoverInput => ({
  title: "Large Print Sudoku Puzzles for Adults",
  subtitle: "200 easy to hard puzzles to sharpen your mind",
  author: "Ada Writer",
  backText: "Relax with puzzles that start gentle and build up.",
  palette,
  badge: "200 puzzles",
  series: "Brain Breaks",
  volume: "2",
  inside: ["Easy: 50 sudoku puzzles", "Answer keys at the back"],
  ...over,
});

const texts = (els: Project["cover"]["elements"]) => els.filter((e): e is TextElement => e.type === "text");

describe("template library", () => {
  it("keeps the AI's template and palette choices in step with the library", () => {
    expect([...TEMPLATE_CHOICES].sort()).toEqual(COVER_TEMPLATES.map((t) => t.id).sort());
    expect([...PALETTE_CHOICES].sort()).toEqual(PALETTES.map((p) => p.id).sort());
  });

  it("files every design on at least one shelf", () => {
    const tags = new Set(TEMPLATE_TAGS.map((t) => t.id));
    for (const t of COVER_TEMPLATES) {
      expect(t.tags.length, t.id).toBeGreaterThan(0);
      for (const tag of t.tags) expect(tags.has(tag), `${t.id}:${tag}`).toBe(true);
    }
  });

  it.each(["5x8", "6x9", "8.5x11"])("every design and palette is readable and stays on the front at %s", (trim) => {
    const p = book(trim, "Large Print Sudoku Puzzles for Adults");
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    for (const t of COVER_TEMPLATES)
      for (const palette of PALETTES) {
        const cover = buildCover(t.id, input(palette), cg);
        const notes = checkDesign({ ...p, cover: { ...p.cover, ...cover } }).filter((n) => n.area === "cover" && n.severity !== "low");
        expect(notes, `${t.id}/${palette.id}`).toEqual([]);
        for (const el of cover.elements) {
          const b = elementBounds(el);
          const cx = b.x + b.width / 2;
          // Nothing drawn for the front may cross the fold onto the spine.
          if (cx > cg.front.x && b.x < cg.spineBox.x) continue; // full-wrap backgrounds
          if (cx > cg.front.x) expect(b.x, `${t.id} ${el.name}`).toBeGreaterThanOrEqual(cg.front.x - 0.5);
          // Front text stays inside the safe zone.
          if (el.type === "text" && cx > cg.front.x && !el.rotation) {
            expect(b.x, `${t.id} ${el.name}`).toBeGreaterThanOrEqual(cg.frontSafe.x - 0.5);
            expect(b.x + b.width, `${t.id} ${el.name}`).toBeLessThanOrEqual(cg.frontSafe.x + cg.frontSafe.width + 0.5);
            expect(b.y, `${t.id} ${el.name}`).toBeGreaterThanOrEqual(cg.frontSafe.y - 0.5);
            expect(b.y + b.height, `${t.id} ${el.name}`).toBeLessThanOrEqual(cg.frontSafe.y + cg.frontSafe.height + 0.5);
          }
        }
      }
  });

  it("shows the badge, series and volume only where the design has room for them", () => {
    const cg = coverGeometry(book("6x9", "T").spec, 120);
    const names = (id: string, over: Partial<CoverInput> = {}) => texts(buildCover(id, input(PALETTES[1], over), cg).elements).map((e) => e.name);
    expect(names("starburst")).toContain("Badge text");
    expect(names("starburst", { badge: "" })).not.toContain("Badge text");
    expect(names("series")).toEqual(expect.arrayContaining(["Volume", "Series"]));
    expect(names("series", { volume: undefined, series: "" })).not.toContain("Volume");
  });

  it("reads the series and badge from the book", () => {
    expect(seriesVolume("Brain Breaks, Book 2")).toBe("2");
    expect(seriesVolume("Vol. 12 Puzzles")).toBe("12");
    expect(seriesVolume("Brain Breaks")).toBeUndefined();
    expect(seriesName("Brain Breaks, Book 2")).toBe("Brain Breaks");
    expect(seriesName("Brain Breaks")).toBe("Brain Breaks");
    expect(coverBadge(book("6x9", "Sudoku", 150))).toBe("150 puzzles");
    const journal = createProject({ name: "J", bookType: "journal", trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "", interior: [{ kind: "lined", count: 100, spacingIn: 0.3125, header: true }] });
    expect(coverBadge(journal)).toBe("");
    journal.metadata.title = "Large Print Gratitude Journal";
    expect(coverBadge(journal)).toBe("Large print");
  });

  it("maps new style words to the new designs offline", () => {
    expect(restyleOffline("more floral", "band", "sage").template).toBe("botanical");
    expect(restyleOffline("make it look vintage", "band", "sage").template).toBe("label");
    expect(restyleOffline("purple please", "band", "sage").palette).toBe("lavender");
  });

  it("rotates hues", () => {
    expect(shiftHue("#ff0000", 120)).toBe("#00ff00");
    expect(shiftHue("#808080", 90)).toBe("#808080");
  });
});

describe("saved cover templates", () => {
  function savedFrom(templateId = "series") {
    const a = book("6x9", "Sudoku for Seniors", 120);
    const cga = coverGeometry(a.spec, a.interior.pages.length);
    Object.assign(a.cover, buildCover(templateId, input(PALETTES[5], { title: a.metadata.title, thumbs: [] }), cga));
    return { a, cga, t: captureCoverTemplate(a, cga, "Brain Breaks series") };
  }

  it("leaves out what belongs to one book", () => {
    const { t } = savedFrom();
    const names = t.elements.map((e) => e.name);
    for (const n of ["Back blurb", "Inside heading", "Inside item", "Spine text"]) expect(names).not.toContain(n);
    expect(names).toContain("Title");
    expect(t.back.family).toBe("Inter");
  });

  it("puts the next book's words on the same design at another size", () => {
    const { t } = savedFrom();
    const b = book("8.5x11", "Word Search Fun", 300);
    const cg = coverGeometry(b.spec, b.interior.pages.length);
    const res = applyCoverTemplate(t, { title: "Word Search Fun", subtitle: "", author: "Ada Writer", backText: "A brand new blurb.", series: "Brain Breaks", volume: "3", inside: ["100 word searches"] }, cg);
    const els = res.cover.elements;
    const title = texts(els).find((e) => e.name === "Title")!;
    expect(title.text).toBe("WORD SEARCH FUN");
    expect(elementBounds(title).x).toBeGreaterThanOrEqual(cg.front.x);
    expect(title.x + title.width).toBeLessThanOrEqual(cg.width);
    expect(texts(els).find((e) => e.name === "Volume")!.text).toBe("3");
    // No subtitle in the new book: no subtitle element.
    expect(texts(els).some((e) => e.name === "Subtitle")).toBe(false);
    // Back cover and spine rebuilt from the new book.
    expect(texts(els).find((e) => e.name === "Back blurb")!.text).toBe("A brand new blurb.");
    expect(texts(els).some((e) => e.text.includes("Sudoku for Seniors"))).toBe(false);
    expect(texts(els).some((e) => e.name === "Spine text")).toBe(true);
    expect(res.cover.background).toBe(t.background);
    expect(res.cover.templateId).toBe(`saved:${t.id}`);
    // Full-width bands still span the new front panel.
    const header = els.find((e) => e.name === "Header")!;
    expect(header.x).toBeCloseTo(cg.front.x, 3);
    expect(header.x + header.width).toBeCloseTo(cg.width, 3);
    expect(res.warnings).toEqual([]);
    const p = { ...b, cover: { ...b.cover, ...res.cover } };
    expect(checkDesign(p).filter((n) => n.area === "cover" && n.severity === "high")).toEqual([]);
  });

  it("only shifts the front by the spine change when the trim is the same", () => {
    const { t, a, cga } = savedFrom("botanical");
    const cg = coverGeometry(a.spec, 300);
    const res = applyCoverTemplate(t, { title: a.metadata.title, subtitle: a.metadata.subtitle, author: "Ada Writer", backText: "" }, cg);
    const before = t.elements.find((e) => e.name === "Title plate")!;
    const after = res.cover.elements.find((e) => e.name === "Title plate")!;
    expect(after.x - before.x).toBeCloseTo(cg.spine - cga.spine, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.width).toBeCloseTo(before.width, 3);
  });

  it("carries images and warns when they must stretch", () => {
    const { a, cga } = savedFrom("minimal");
    a.assets.push({ id: "logo", name: "logo.png", mime: "image/png", dataUrl: "data:image/png;base64,AAAA", widthPx: 10, heightPx: 10, origin: "user-upload", license: { license: "own", author: "me", source: "", commercialUse: true }, contentHash: "x", createdAt: "" });
    a.cover.elements.push({ id: "img", type: "image", assetId: "logo", name: "Logo", x: cga.front.x + 40, y: 60, width: 50, height: 50, rotation: 0 });
    const t = captureCoverTemplate(a, cga, "With logo");
    expect(t.assets.map((x) => x.id)).toEqual(["logo"]);
    const cg = coverGeometry(book("8.5x11", "X").spec, 120);
    const res = applyCoverTemplate(t, { title: "X", subtitle: "", author: "", backText: "" }, cg);
    expect(res.assets.map((x) => x.id)).toEqual(["logo"]);
    expect(res.warnings.join(" ")).toMatch(/stretched/);
    // Author left empty: the author line is dropped.
    expect(res.cover.elements.some((e) => e.name === "Author")).toBe(false);
  });

  it("round-trips through a file and rejects files that aren't templates", () => {
    const { t } = savedFrom();
    expect(parseCoverTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
    expect(() => parseCoverTemplate({ kind: "something-else" })).toThrow(/not a BookStudio cover template/);
    expect(() => parseCoverTemplate({ ...t, elements: [{ type: "script", x: 0, y: 0 }] })).toThrow(/unknown element/);
    expect(() => parseCoverTemplate({ ...t, elements: [...t.elements, { id: "i", type: "image", assetId: "missing", x: 0, y: 0, width: 1, height: 1, rotation: 0 }] })).toThrow(/doesn't include/);
    expect(() => parseCoverTemplate({ ...t, assets: [{ id: "a", mime: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,AA" }] })).toThrow(/PNG or JPEG/);
  });
});
