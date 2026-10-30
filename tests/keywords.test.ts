import { describe, expect, it } from "vitest";
import { coversPhrase, packKeywords, rankKeywords } from "@/lib/market/keywords";
import { validateListing } from "@/lib/metadata/validate";
import { applyRevisedListing } from "@/lib/quality";
import { createProject } from "@/lib/schema/factory";
import type { KeywordMetric } from "@/lib/market/types";

const kw = (keyword: string, volume: number | null = null): KeywordMetric => ({ keyword, volume, source: "test" });

describe("keyword slots", () => {
  it("ranks by volume, merges duplicates and keeps unknowns in order after", () => {
    const r = rankKeywords([kw("Sudoku for Seniors"), kw("large print sudoku", 900), kw("sudoku for seniors", 1200), kw("brain games")]);
    expect(r.map((k) => k.keyword)).toEqual(["sudoku for seniors", "large print sudoku", "brain games"]);
    expect(r[0].volume).toBe(1200);
  });

  it("never repeats title words and packs short phrases together", () => {
    const p = packKeywords({
      title: "Large Print Sudoku",
      subtitle: "Puzzles for Seniors",
      candidates: [kw("large print sudoku for seniors", 5000), kw("sudoku puzzle book for adults", 3000), kw("easy sudoku", 2000), kw("brain games for elderly", 800), kw("gifts for grandma", 400)],
    });
    expect(p.covered).toEqual(["large print sudoku for seniors"]);
    expect(p.slots.join(" ")).not.toMatch(/\b(large|print|sudoku|seniors)\b/);
    expect(p.slots).toEqual(["puzzle book adults easy brain games elderly", "gifts grandma"]);
    expect(p.top?.keyword).toBe("large print sudoku for seniors");
    expect(p.topInTitle).toBe(true);
  });

  it("stays inside 7 slots of 50 characters and says what didn't fit", () => {
    const many = Array.from({ length: 30 }, (_, i) => kw(`uniqueword${i} anotherword${i} thirdword${i}`, 1000 - i));
    const p = packKeywords({ title: "Word Search", subtitle: "", candidates: many });
    expect(p.slots.length).toBe(7);
    expect(p.slots.every((s) => s.length <= 50)).toBe(true);
    expect(p.skipped.some((s) => s.why.includes("no room"))).toBe(true);
    const project = createProject({ name: "t", bookType: "puzzle", trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "A" });
    const v = validateListing({ ...project.metadata, title: "Word Search", keywords: p.slots });
    expect(v.errors.filter((e) => /keyword/i.test(e))).toEqual([]);
  });

  it("drops phrases with terms KDP doesn't allow", () => {
    const p = packKeywords({ title: "Gratitude Journal", subtitle: "", candidates: [kw("bestseller gratitude journal", 9000), kw("journal for women", 100)] });
    expect(p.skipped[0].keyword).toBe("bestseller gratitude journal");
    expect(p.slots).toEqual(["women"]);
  });

  it("reports when the most-searched phrase is missing from the title", () => {
    const p = packKeywords({ title: "Daily Wins", subtitle: "A Journal", candidates: [kw("gratitude journal for women", 4000)] });
    expect(p.topInTitle).toBe(false);
    expect(coversPhrase("Gratitude Journal for Women", "gratitude journal for women")).toBe(true);
  });

  it("keeps measured phrases when a critique's revised keywords are applied", () => {
    const base = createProject({ name: "t", bookType: "puzzle", trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "A" });
    const project = { ...base, metadata: { ...base.metadata, title: "Large Print Sudoku", description: "x".repeat(300) }, market: { keyword: "sudoku", fetchedAt: "", source: "dataforseo", products: [], keywords: [kw("brain games for seniors", 6600)] } };
    const r = applyRevisedListing(project, { title: "", subtitle: "Puzzles for Adults", description: "", keywords: ["easy puzzles gift"], categories: [] });
    expect(r.metadata.keywords.join(" ")).toMatch(/^brain games seniors/);
    expect(r.metadata.keywords.join(" ")).toMatch(/easy gift/);
  });
});
