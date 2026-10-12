import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { assembleBook, howToPlay, planSections, sectionDetail, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { offlineTask } from "@/lib/ai/offline";
import { genreOf, GENRES, type GenreId } from "@/lib/cover/genres";
import { generatePages, type GeneratorConfig } from "@/lib/generators/pages";
import { interiorStyle, LARGE_PRINT_MIN_PT, ornament, styleOf, type OrnamentKind } from "@/lib/generators/style";
import { isRecto } from "@/lib/kdp/geometry";
import { checkDesign } from "@/lib/quality/design";
import { interiorStats } from "@/lib/quality/interior";
import { renderInteriorPdf } from "@/lib/render/pdf";
import { createProject } from "@/lib/schema/factory";
import type { BookType, Element, Project } from "@/lib/schema/project";
import { nodeFontLoader } from "./helpers";

function fill(sections: PlannedSection[]): PlannedSection[] {
  return sections.map((s) => {
    const need = s.content;
    const c = s.config;
    if (!need) return s;
    if (need.task === "journal-prompts" && c.kind === "journal-prompts") return { ...s, config: { ...c, prompts: offlineTask("journal-prompts", { topic: need.theme, audience: "adults", count: need.count }).prompts } };
    if (need.task === "word-lists" && (c.kind === "word-search" || c.kind === "word-scramble"))
      return { ...s, config: { ...c, puzzles: offlineTask("word-lists", { topic: need.theme, audience: "adults", count: need.count, wordsPerPuzzle: need.wordsPerPuzzle, maxLength: need.maxLength }).puzzles } };
    if (need.task === "phrases") {
      const phrases = offlineTask("phrases", { topic: need.theme, audience: "adults", count: need.count, maxLength: need.maxLength, style: need.style }).phrases;
      if (c.kind === "cryptogram") return { ...s, config: { ...c, phrases } };
      if (c.kind === "gratitude") return { ...s, config: { ...c, affirmations: phrases } };
    }
    return s;
  });
}

/** Build a book the way autopilot does, styled for its genre. */
function build(bookType: BookType, topic: string, audience: string, trimId: string, pageTarget: number): Project {
  const ctx = { bookType, topic, audience, notes: "" };
  const blueprint = validateBlueprint(recipeBlueprint(ctx), ctx).blueprint;
  const planned = fill(planSections(blueprint, { ...ctx, trimId, pageTarget }));
  const sections = assembleBook(blueprint, planned, { ...ctx, trimId, pageTarget, title: "Test Book", subtitle: "A subtitle", author: "Ada Writer" });
  const genre = genreOf({ bookType, topic, audience }).id;
  return createProject({ name: "Test Book", bookType, trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: sections, style: { genre, largePrint: blueprint.largePrint || genre === "large-print" } });
}

const texts = (els: Element[]) => els.filter((e): e is Extract<Element, { type: "text" }> => e.type === "text" && !!e.text.trim());

describe("interior styles", () => {
  it("follow the cover's genre, with large print sizes at 14 pt or more", () => {
    for (const id of Object.keys(GENRES) as GenreId[]) {
      const s = interiorStyle({ genre: id });
      expect(s.heading.family).toBeTruthy();
      expect(s.sizes.divider).toBeGreaterThan(s.sizes.pageTitle);
    }
    const lp = interiorStyle({ genre: "large-print" });
    expect(lp.largePrint).toBe(true);
    expect(Math.min(lp.sizes.small, lp.sizes.body, lp.sizes.label)).toBeGreaterThanOrEqual(LARGE_PRINT_MIN_PT);
    expect(interiorStyle({ genre: "journal", largePrint: true }).sizes.small).toBeGreaterThanOrEqual(LARGE_PRINT_MIN_PT);
  });

  it("keeps books made before styles in the classic look, so regenerated sections match", () => {
    const p = createProject({ name: "Old", bookType: "journal", trimId: "6x9", paper: "white", ink: "black", bleed: false });
    delete p.interior.style;
    expect(styleOf(p).heading.family).toBe("Lora");
    expect(styleOf(p).genre).toBeNull();
  });

  it("new projects store their style and size page numbers to it", () => {
    const p = createProject({ name: "Big Sudoku", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, style: { genre: "large-print", largePrint: true } });
    expect(p.interior.style).toEqual({ genre: "large-print", largePrint: true });
    expect(p.interior.pageNumbers.fontSize).toBe(12);
  });

  it("every ornament is valid path data that embeds in a PDF", async () => {
    const kinds: OrnamentKind[] = ["rule", "grid", "stars", "sprig", "flourish", "diamond", "bars", "double-rule"];
    for (const k of kinds) for (const o of ornament(k)) expect(o.d).toMatch(/^M [-\d.]/);
    // One divider per genre style.
    const p = createProject({ name: "Ornaments", bookType: "journal", trimId: "6x9", paper: "white", ink: "black", bleed: false });
    p.interior.pages = (Object.keys(GENRES) as GenreId[]).flatMap((g) => generatePages({ kind: "section-divider", title: g, subtitle: "Sub" }, { spec: p.spec, pageCountHint: 8, style: interiorStyle({ genre: g }) }));
    const pdf = await PDFDocument.load(await renderInteriorPdf(p, { loadFont: nodeFontLoader }));
    expect(pdf.getPageCount()).toBe(Object.keys(GENRES).length);
  });
});

describe("large print books", () => {
  const project = build("puzzle", "large print sudoku", "seniors", "8.5x11", 120);

  it("set everything a reader reads at 14 pt or more", () => {
    const stats = interiorStats(project);
    expect(stats.largePrint).toBe(true);
    expect(stats.minReaderPt).toBeGreaterThanOrEqual(LARGE_PRINT_MIN_PT);
    expect(stats.pagesUnderLargePrint).toBe(0);
    expect(checkDesign(project).some((n) => n.issue.includes("large-print"))).toBe(false);
  });

  it("print four solved grids to an answer-key page with readable digits", () => {
    const sec = project.interior.sections.find((s) => s.config.kind === "sudoku" && s.config.part === "solutions")!;
    expect(sec.config.kind === "sudoku" && sec.config.keysPerPage).toBe(4);
    const key = project.interior.pages.find((p) => p.sectionId === sec.id && p.generator?.kind === "sudoku-solutions" && p.elements.length > 20)!;
    expect(Math.min(...texts(key.elements).map((t) => t.fontSize))).toBeGreaterThanOrEqual(12);
  });

  it("are flagged when a page falls under 14 pt", () => {
    const shrunk: Project = { ...project, interior: { ...project.interior, pages: project.interior.pages.map((p, i) => (i === 8 ? { ...p, elements: p.elements.map((e) => (e.type === "text" ? { ...e, fontSize: 10 } : e)) } : p)) } };
    const note = checkDesign(shrunk).find((n) => n.issue.includes("large-print"));
    expect(note?.severity).toBe("medium");
    expect(note?.pageIndex).toBe(8);
  });
});

describe("book structure", () => {
  const books: [BookType, string, string, string, number][] = [
    ["puzzle", "large print sudoku", "seniors", "8.5x11", 120],
    ["puzzle", "variety puzzles", "adults", "6x9", 140],
    ["activity", "mazes and word scrambles", "kids ages 6-9", "8.5x11", 60],
    ["journal", "gratitude journal for nurses", "nurses", "6x9", 120],
    ["journal", "self-discovery journal", "women", "6x9", 160],
  ];

  it.each(books)("%s: %s opens every part on a right-hand page, with few blank pages", (bookType, topic, audience, trimId, target) => {
    const project = build(bookType, topic, audience, trimId, target);
    const stats = interiorStats(project);
    expect(stats.dividers).toBeGreaterThan(0);
    expect(stats.dividersOnRecto).toBe(stats.dividers);
    // The only blank pages are the ones some dividers bring with them.
    expect(project.interior.sections.some((s) => s.config.kind === "blank")).toBe(false);
    const blanks = project.interior.pages.filter((p) => p.generator?.kind === "blank");
    expect(blanks.length).toBeLessThanOrEqual(2);
    expect(blanks.every((p) => p.hideNumber)).toBe(true);
    // Every divider says what's in its part.
    for (const s of project.interior.sections) if (s.config.kind === "section-divider") expect(s.config.detail ?? "").not.toBe("");
  });

  it("explains each puzzle kind once, on its first divider", () => {
    const project = build("puzzle", "large print sudoku", "seniors", "8.5x11", 120);
    const dividers = project.interior.sections.filter((s) => s.config.kind === "section-divider").map((s) => s.config as Extract<GeneratorConfig, { kind: "section-divider" }>);
    expect(dividers[0].howTo).toMatch(/1 to 9/);
    expect(dividers[0].kicker).toBe("Part 1");
    expect(dividers.slice(1).filter((d) => d.howTo).length).toBe(0);
  });

  it("describes sections and their rules", () => {
    expect(sectionDetail({ kind: "sudoku", count: 20, difficulty: "easy", perPage: 1, solutions: true, seed: 1, startNumber: 21 })).toBe("Sudoku 21–40  ·  Easy");
    expect(sectionDetail({ kind: "maze", count: 1, difficulty: "hard", solutions: true, seed: 1 })).toBe("Maze 1  ·  Hard");
    expect(howToPlay({ kind: "word-search", puzzles: [], size: 13, difficulty: "hard", solutions: true, seed: 1 })).toMatch(/backwards and diagonally/);
    expect(howToPlay({ kind: "word-search", puzzles: [], size: 13, difficulty: "easy", solutions: true, seed: 1 })).toMatch(/across and down\./);
    expect(howToPlay({ kind: "lined", count: 2, spacingIn: 0.3, header: false })).toBe("");
  });

  it("lays out the contents with dotted leaders and the title page in the heading face", () => {
    const project = build("journal", "self-discovery journal", "women", "6x9", 160);
    const style = styleOf(project);
    const toc = project.interior.pages.find((p) => p.generator?.kind === "table-of-contents")!;
    expect(toc.elements.filter((e) => e.type === "line" && e.dash).length).toBeGreaterThan(0);
    const title = project.interior.pages[0].elements.find((e) => e.name === "Title");
    expect(title?.type === "text" && title.fontFamily).toBe(style.heading.family);
    expect(project.interior.pages[0].elements.some((e) => e.name === "Ornament")).toBe(true);
  });

  it("keeps every divider on an odd page number", () => {
    const project = build("puzzle", "variety puzzles", "adults", "6x9", 140);
    project.interior.pages.forEach((p, i) => {
      if (p.generator?.kind === "section-divider") expect(isRecto(i), `page ${i + 1}`).toBe(true);
    });
  });
});
