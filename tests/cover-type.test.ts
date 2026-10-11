import { describe, expect, it } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont } from "pdf-lib";
import { offlineSubtitle, offlineTitle, audienceHead } from "@/lib/ai/offline";
import { GENRES, genreOf } from "@/lib/cover/genres";
import { balancedWidth, backCover, sentences } from "@/lib/cover/layout";
import { applyCoverTemplate, captureCoverTemplate } from "@/lib/cover/library";
import { splitTitle } from "@/lib/cover/lockup";
import { buildCover, COVER_TEMPLATES, PALETTES, type CoverInput } from "@/lib/cover/templates";
import { coverGeometry } from "@/lib/kdp/geometry";
import { runPreflight } from "@/lib/preflight";
import { fontFile, FONTS } from "@/lib/render/fonts";
import { measureLines, textWidth } from "@/lib/render/metrics";
import { wrapText } from "@/lib/render/textLayout";
import { createProject } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";
import { contrastRatio, TEXT_CONTRAST } from "@/lib/util/color";
import { nodeFontLoader } from "./helpers";

const fonts = new Map<string, PDFFont>();
async function pdfFont(family: string, bold: boolean): Promise<PDFFont> {
  const file = fontFile(family, bold);
  if (!fonts.has(file)) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    fonts.set(file, await doc.embedFont(await nodeFontLoader(file), { subset: true }));
  }
  return fonts.get(file)!;
}

/** Lines the PDF renderer will actually draw for a text element. */
async function renderedLines(el: TextElement): Promise<string[]> {
  const f = await pdfFont(el.fontFamily, el.bold);
  const spacing = (el.letterSpacing ?? 0) * el.fontSize;
  return wrapText(el.text, el.width + 0.5, (s) => f.widthOfTextAtSize(s, el.fontSize) + [...s].length * spacing);
}

function book(trimId: string, title: string, bookType: Project["bookType"] = "puzzle"): Project {
  const p = createProject({ name: title, bookType, trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: [{ kind: "lined", count: 120, spacingIn: 0.3, header: false }] });
  p.metadata.title = title;
  return p;
}

const TITLES = ["Sudoku", "Large Print Sudoku Puzzles for Seniors", "The Ultimate Big Book of Word Search Puzzles for Adults: 300 Puzzles with Solutions to Keep Your Mind Sharp"];

describe("splitTitle", () => {
  it.each([
    ["Large Print Sudoku Puzzles for Seniors", { kicker: "Large Print", hero: "Sudoku", support: "Puzzles for Seniors" }],
    ["Daily Gratitude Journal", { kicker: "Daily", hero: "Gratitude", support: "Journal" }],
    ["Bird Watching Log Book", { hero: "Bird Watching", support: "Log Book" }],
    ["Easy to Hard Sudoku", { kicker: "Easy to Hard", hero: "Sudoku" }],
    ["Mazes and Word Puzzles for Kids", { hero: "Mazes and Word Puzzles", support: "for Kids" }],
    ["Sudoku", { hero: "Sudoku" }],
    ["Puzzle Book", { hero: "Puzzle Book" }],
  ])("%s", (title, parts) => {
    expect(splitTitle(title)).toEqual(parts);
  });

  it("never drops or reorders a word", () => {
    for (const t of [...TITLES, "My 5-Minute Mindfulness Journal for Busy Moms", "Weekly Planner: Undated, 52 Weeks"]) {
      const p = splitTitle(t);
      expect([p.kicker, p.hero, p.support].filter(Boolean).join(" ").replace(/[^\w]+/g, " ").trim().toLowerCase()).toBe(t.replace(/[^\w]+/g, " ").trim().toLowerCase());
    }
  });
});

describe("balanced lines", () => {
  it("evens out lines and never leaves a short word alone on the last line", () => {
    const s = "The Big Book of Word Search Puzzles for Adults";
    const w = balancedWidth(s, "Oswald", 40, 300);
    const lines = measureLines(s, "Oswald", true, 40, w);
    expect(lines.length).toBe(measureLines(s, "Oswald", true, 40, 300).length);
    expect(lines[lines.length - 1].split(" ").length).toBeGreaterThan(1);
    const widths = lines.map((l) => textWidth(l, "Oswald", true, 40));
    // Greedy wrapping at the full width leaves a long first line and a stub; balanced lines are within a word of each other.
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(textWidth("Search ", "Oswald", true, 40));
  });
});

describe("cover text fits", () => {
  const genres = [undefined, ...Object.values(GENRES).map((g) => g.type)];
  it.each(["5x8", "6x9", "8.5x11"])("titles render on the lines they were laid out for at %s", async (trimId) => {
    for (const title of TITLES) {
      const p = book(trimId, title);
      const cg = coverGeometry(p.spec, p.interior.pages.length);
      for (const t of COVER_TEMPLATES) {
        for (const type of genres) {
          const input: CoverInput = { title, subtitle: "Easy to hard puzzles with solutions", author: "Ada Writer", backText: "", palette: PALETTES[0], badge: "200 puzzles", series: "Brain Breaks", volume: "2", type };
          const cover = buildCover(t.id, input, cg);
          for (const el of cover.elements) {
            if (el.type !== "text" || !el.name?.startsWith("Title")) continue;
            const lines = await renderedLines(el);
            const planned = Math.round(el.height / (el.fontSize * 1.13 * el.lineHeight));
            expect(lines.length, `${t.id} ${trimId} ${type?.hero ?? "own"} "${el.text}"`).toBeLessThanOrEqual(Math.max(1, planned));
          }
        }
      }
    }
  });

  it("every genre's templates pass preflight's cover checks", () => {
    for (const trimId of ["6x9", "8.5x11"]) {
      for (const g of Object.values(GENRES)) {
        for (const templateId of g.templates) {
          const p = book(trimId, TITLES[1]);
          const cg = coverGeometry(p.spec, p.interior.pages.length);
          const palette = PALETTES.find((x) => x.id === g.palettes[0])!;
          p.cover = { ...p.cover, ...buildCover(templateId, { title: TITLES[1], subtitle: "Easy to hard puzzles", author: "Ada Writer", backText: "One. Two. Three.", palette, type: g.type, inside: ["Easy: 50 puzzles"] }, cg) };
          const rep = runPreflight(p);
          for (const id of ["cover-safe", "barcode", "spine"]) expect(rep.checks.find((c) => c.id === id)?.status, `${g.id} ${templateId} ${trimId} ${id}`).not.toBe("fail");
        }
      }
    }
  });

  it("every palette's text color reads on its background", () => {
    for (const p of PALETTES) expect(contrastRatio(p.fg, p.bg), p.id).toBeGreaterThanOrEqual(TEXT_CONTRAST);
  });

  it("every genre names fonts, templates and palettes that exist", () => {
    for (const g of Object.values(GENRES)) {
      for (const f of [g.type.hero, g.type.support, g.type.kicker, g.type.body]) expect(FONTS.some((x) => x.family === f), `${g.id} ${f}`).toBe(true);
      for (const t of g.templates) expect(COVER_TEMPLATES.some((x) => x.id === t), `${g.id} ${t}`).toBe(true);
      for (const id of g.palettes) expect(PALETTES.some((x) => x.id === id), `${g.id} ${id}`).toBe(true);
    }
  });
});

describe("back cover", () => {
  const p = book("6x9", "Daily Gratitude Journal", "journal");
  const cg = coverGeometry(p.spec, p.interior.pages.length);
  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i + 1} tells you something useful about this book.`).join(" ");
  const input: CoverInput = { title: "Daily Gratitude Journal", subtitle: "", author: "Ada", backText: long, palette: PALETTES[0], inside: ["Daily Gratitude: 96 pages", "Reflections: 17 pages", "A closing note"] };

  it("never cuts copy mid-sentence and shortens by whole sentences only", () => {
    const els = backCover(cg, input, "#111111");
    const copy = els.flatMap((e) => (e.type === "text" && (e.name === "Back hook" || e.name === "Back blurb") ? [e.text] : [])).join(" ");
    expect(copy).not.toContain("…");
    expect(long.startsWith(copy)).toBe(true);
    expect(copy.endsWith(".")).toBe(true);
  });

  it("keeps everything inside the back safe area and clear of the barcode", () => {
    const els = backCover(cg, { ...input, backText: "A short hook. Then a little more about the book." }, "#111111");
    for (const e of els) {
      expect(e.x).toBeGreaterThanOrEqual(cg.backSafe.x - 0.01);
      expect(e.x + e.width).toBeLessThanOrEqual(cg.backSafe.x + cg.backSafe.width + 0.01);
      expect(e.y + e.height).toBeLessThanOrEqual(cg.barcode.y + 0.01);
    }
    expect(els.some((e) => e.name === "Back hook")).toBe(true);
    expect(els.filter((e) => e.name === "Inside check")).toHaveLength(3);
  });

  it("splits sentences without breaking numbers like 8.5", () => {
    expect(sentences('Made for you. 120 pages in an 8.5" x 11" paperback. Enjoy!')).toEqual(["Made for you.", '120 pages in an 8.5" x 11" paperback.', "Enjoy!"]);
  });
});

describe("saved templates with a split title", () => {
  it("re-split the new book's title and drop parts it doesn't have", () => {
    const a = book("6x9", "Large Print Sudoku Puzzles for Seniors");
    const cg = coverGeometry(a.spec, a.interior.pages.length);
    a.cover = { ...a.cover, ...buildCover("puzzle", { title: a.metadata.title, subtitle: "", author: "Ada", backText: "", palette: PALETTES[0], type: GENRES.puzzle.type }, cg) };
    const saved = captureCoverTemplate(a, cg, "Mine");
    const out = applyCoverTemplate(saved, { title: "Sudoku for Kids", subtitle: "", author: "Ada", backText: "" }, cg);
    const named = (n: string) => out.cover.elements.find((e): e is TextElement => e.type === "text" && e.name === n);
    expect(named("Title")?.text).toBe("SUDOKU");
    expect(named("Title support")?.text).toBe("FOR KIDS");
    expect(named("Title kicker")).toBeUndefined();
  });
});

describe("offline titles and subtitles", () => {
  it("doesn't repeat the format noun the topic already names", () => {
    expect(offlineTitle("Daily gratitude journal", "journal")).toBe("Daily Gratitude Journal");
    expect(offlineTitle("Large print sudoku puzzles for seniors", "puzzle")).toBe("Large Print Sudoku Puzzles for Seniors");
    expect(offlineTitle("Bird watching log book", "log-book")).toBe("Bird Watching Log Book");
    expect(offlineTitle("Gardening", "log-book")).toBe("Gardening Log Book");
    expect(offlineTitle("Camping for families", "planner")).toBe("Camping Planner for Families");
  });

  it("names the reader in a few words", () => {
    expect(audienceHead("Seniors who want easy-to-read puzzles")).toBe("Seniors");
    expect(offlineSubtitle("puzzle", "Large print sudoku", "Seniors who want easy-to-read puzzles")).toBe("Easy-to-Read Large Print Puzzles with Solutions for Seniors");
  });

  it("picks the genre from the book type and topic", () => {
    expect(genreOf({ bookType: "puzzle", topic: "Large print sudoku", audience: "" }).id).toBe("large-print");
    expect(genreOf({ bookType: "activity", topic: "Mazes", audience: "Kids ages 6 to 9" }).id).toBe("kids");
    expect(genreOf({ bookType: "journal", topic: "Daily gratitude journal", audience: "Women" }).id).toBe("wellness");
    expect(genreOf({ bookType: "journal", topic: "Prayer journal", audience: "" }).id).toBe("faith");
    expect(genreOf({ bookType: "log-book", topic: "Bird watching", audience: "" }).id).toBe("log-book");
  });
});
