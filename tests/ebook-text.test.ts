import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ebookLayoutDefault, ebookLayoutOf, paragraphs, sectionsToBlocks, storyWords } from "@/lib/export/ebookBlocks";
import { generatorInfo } from "@/lib/generators/pages";
import { runPreflight } from "@/lib/preflight";
import type { EpubImage } from "@/lib/render/epub";
import { buildTextEpub } from "@/lib/render/epubText";
import { createProject } from "@/lib/schema/factory";
import { editionDraft } from "@/lib/schema/formats";

const story = "The lighthouse keeper was found at dawn.\nHis lamp was still warm.\n\nNobody had climbed the stairs since noon.\n\nExhibit 1: the logbook\nTurn the page and solve the word search.";

const mystery = () =>
  createProject({
    name: "The Lighthouse Case",
    bookType: "mystery",
    trimId: "6x9",
    paper: "white",
    ink: "black",
    bleed: false,
    author: "Ada <& Co>",
    interior: [
      { label: "Title page", role: "front", config: { kind: "title-page", title: "The Lighthouse Case", subtitle: "A Puzzle Mystery", author: "Ada" } },
      { label: "How to solve", role: "front", config: { kind: "text-page", title: "How to Solve the Case", body: "Read each chapter.\n\nSolve its puzzle." } },
      { label: "Contents", role: "front", config: { kind: "table-of-contents", entries: [] } },
      { label: "Chapter 1: The Keeper", role: "body", config: { kind: "story", title: "The Keeper", kicker: "Chapter 1", body: story, pages: 2 } },
      { label: "Clue 1", role: "body", config: generatorInfo("word-search").defaults() },
      { label: "Case closed", role: "back", config: { kind: "section-divider", title: "Case Closed", subtitle: "Make your accusation", kicker: "The solution" } },
      { label: "The accusation", role: "back", config: { kind: "journal-prompts", prompts: ["Who killed the keeper?"], spacingIn: 0.3125 } },
      { label: "Detective's notes", role: "back", config: { kind: "lined", count: 3, spacingIn: 0.3125, header: false } },
    ],
  });

const img = (w = 600, h = 900): EpubImage => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg", width: w, height: h });

describe("text eBook blocks", () => {
  it("turns prose into text, puzzles into pictures, and leaves out writing space and the printed contents", () => {
    const p = mystery();
    const { blocks, omitted } = sectionsToBlocks(p);
    expect(blocks.map((b) => b.type)).toEqual(["title", "text", "chapter", "images", "heading", "text"]);
    const chapter = blocks[2];
    expect(chapter).toMatchObject({ type: "chapter", kicker: "Chapter 1", title: "The Keeper" });
    if (chapter.type === "chapter") {
      expect(chapter.paragraphs[0]).toBe("The lighthouse keeper was found at dawn. His lamp was still warm.");
      expect(chapter.paragraphs).toHaveLength(3);
      expect(chapter.paragraphs[2]).toMatch(/^Exhibit 1: the logbook/);
    }
    const puzzle = blocks[3];
    if (puzzle.type === "images") {
      expect(puzzle.label).toBe("Clue 1");
      expect(puzzle.pageIndices.every((i) => p.interior.pages[i].sectionId === p.interior.sections[4].id)).toBe(true);
      expect(puzzle.pageIndices.length).toBeGreaterThan(0);
    }
    expect(omitted).toEqual(["Contents", "Detective's notes"]);
  });

  it("splits paragraphs on blank lines only", () => {
    expect(paragraphs("a\nb\n\n\n c \r\n\r\nd")).toEqual(["a b", "c", "d"]);
  });

  it("suggests a text eBook for story books and fixed layout otherwise", () => {
    const p = mystery();
    expect(storyWords(p)).toBeGreaterThan(20);
    expect(ebookLayoutDefault(p)).toBe("text");
    const puzzles = createProject({ name: "Word Search", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, interior: [generatorInfo("word-search").defaults()] });
    expect(ebookLayoutDefault(puzzles)).toBe("fixed");
    editionDraft(p, "ebook").ebookLayout = "fixed";
    expect(ebookLayoutOf(p)).toBe("fixed");
  });
});

describe("reflowable EPUB", () => {
  it("has no fixed-layout metadata, a styled XHTML per block, escaped text, puzzle images and a contents list", async () => {
    const p = mystery();
    const { blocks } = sectionsToBlocks(p);
    const puzzlePages = blocks.flatMap((b) => (b.type === "images" ? b.pageIndices : []));
    const bytes = await buildTextEpub({ title: "The Lighthouse Case", author: "Ada <& Co>", language: "en", cover: img(1600, 2560), blocks, images: new Map(puzzlePages.map((i) => [i, img()])) });
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe("mimetype");
    const zip = await JSZip.loadAsync(bytes);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain("pre-paginated");
    expect(opf).not.toContain("fixed-layout");
    expect(opf).toContain("<dc:creator>Ada &lt;&amp; Co&gt;</dc:creator>");
    expect(opf).toContain('properties="cover-image"');
    expect(opf.match(/<itemref /g)).toHaveLength(blocks.length + 1);
    const chapter = await zip.file("OEBPS/s0003.xhtml")!.async("string");
    expect(chapter).toContain('<link rel="stylesheet" type="text/css" href="style.css"/>');
    expect(chapter).toContain('<p class="kicker">Chapter 1</p><h2>The Keeper</h2>');
    expect(chapter).toContain('<p class="first">The lighthouse keeper was found at dawn. His lamp was still warm.</p>');
    expect(chapter.match(/<p[ >]/g)!.length).toBe(4); // kicker + 3 paragraphs
    const puzzle = await zip.file("OEBPS/s0004.xhtml")!.async("string");
    expect(puzzle.match(/<img /g)).toHaveLength(puzzlePages.length);
    for (const i of puzzlePages) expect(zip.file(`OEBPS/images/p${String(i + 1).padStart(4, "0")}.jpg`)).not.toBeNull();
    expect(await zip.file("OEBPS/style.css")!.async("string")).toContain("img{max-width:100%;height:auto}");
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    for (const label of ["How to Solve the Case", "The Keeper", "Clue 1", "Case Closed"]) expect(nav).toContain(`>${label}</a>`);
  });
});

describe("text eBook preflight", () => {
  it("names the sections left out", () => {
    const p = mystery();
    editionDraft(p, "ebook").enabled = true;
    const c = runPreflight(p).checks.find((x) => x.id === "ebook")!;
    expect(c.issues.map((i) => i.message).join(" ")).toMatch(/Left out of the text eBook.*Contents, Detective's notes/);
  });

  it("doesn't count a size measured for the other layout", () => {
    const p = mystery();
    const e = editionDraft(p, "ebook");
    e.enabled = true;
    e.ebookSize = { bytes: 1024 * 1024, pages: p.interior.pages.length, image: "standard", layout: "fixed" };
    expect(runPreflight(p).checks.find((x) => x.id === "ebook")!.issues.map((i) => i.message).join(" ")).toMatch(/Build the eBook/);
  });
});
