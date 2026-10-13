import { produce } from "immer";
import { describe, expect, it } from "vitest";
import { artBox } from "@/lib/cover/art";
import { addLibraryArt, cropKept, GOOD_FIT, keepCandidates, KEEP_CANDIDATES, rankLibrary, type LibraryArt, type LibraryArtSummary } from "@/lib/cover/artLibrary";
import { coverGeometry } from "@/lib/kdp/geometry";
import { createProject } from "@/lib/schema/factory";
import type { CoverArtCandidate, Project } from "@/lib/schema/project";

function book(): Project {
  return createProject({ name: "Big Sudoku", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, author: "Ada", interior: [{ kind: "sudoku", count: 100, difficulty: "easy", perPage: 1, solutions: true, seed: 1 }] });
}

const candidate = (id: string, over: Partial<CoverArtCandidate> = {}): CoverArtCandidate => ({
  id,
  name: `Concept ${id}`,
  prompt: "A calm garden",
  dataUrl: "data:image/jpeg;base64,AAAA",
  widthPx: 1024,
  heightPx: 1536,
  provider: "codex",
  model: "chatgpt-image",
  runId: `run_${id}`,
  layout: "art-full-bleed",
  createdAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

const entry = (id: string, over: Partial<LibraryArtSummary> = {}): LibraryArtSummary => {
  const c: Partial<CoverArtCandidate> = candidate(id);
  delete c.dataUrl;
  return { ...(c as Omit<CoverArtCandidate, "dataUrl">), thumbUrl: "", projectId: "p1", projectTitle: "Old Book", genre: "puzzle", used: false, favorite: false, ...over };
};

describe("art library", () => {
  const p = book();
  const cg = coverGeometry(p.spec, p.interior.pages.length);
  const box = artBox("art-full-bleed", cg);
  const aspect = box.width / box.height;

  it("measures how much of an image a crop keeps", () => {
    expect(cropKept(100, 200, 0.5)).toBe(1);
    expect(cropKept(200, 100, 0.5)).toBeCloseTo(0.25);
    expect(cropKept(100, 100, 0.5)).toBeCloseTo(0.5);
  });

  it("ranks good fits first, then the same kind of book, favorites, and newest", () => {
    const fitW = Math.round(1536 * aspect);
    const entries = [
      entry("wide", { widthPx: 2000, heightPx: 600, createdAt: "2026-10-09T00:00:00.000Z" }),
      entry("other-genre", { widthPx: fitW, heightPx: 1536, genre: "kids", createdAt: "2026-10-08T00:00:00.000Z" }),
      entry("old", { widthPx: fitW, heightPx: 1536, createdAt: "2026-10-01T00:00:00.000Z" }),
      entry("new", { widthPx: fitW, heightPx: 1536, createdAt: "2026-10-05T00:00:00.000Z" }),
      entry("fav", { widthPx: fitW, heightPx: 1536, favorite: true, createdAt: "2026-09-01T00:00:00.000Z" }),
    ];
    const ranked = rankLibrary(entries, { layout: "art-full-bleed", cg, genre: "puzzle" });
    expect(ranked.map((m) => m.entry.id)).toEqual(["fav", "new", "old", "other-genre", "wide"]);
    expect(ranked[4].kept).toBeLessThan(GOOD_FIT);
    expect(ranked[0].dpi).toBeGreaterThan(0);

    const filtered = rankLibrary(entries, { layout: "art-full-bleed", cg, genre: "puzzle", sameGenreOnly: true, goodFitOnly: true, exclude: new Set(["old"]) });
    expect(filtered.map((m) => m.entry.id)).toEqual(["fav", "new"]);
    expect(rankLibrary(entries, { layout: "art-full-bleed", cg, genre: "puzzle", favoritesOnly: true }).map((m) => m.entry.id)).toEqual(["fav"]);
  });

  it("caps a project's candidates without dropping the one on the cover or keeping duplicates", () => {
    const list = Array.from({ length: 12 }, (_, i) => candidate(`a${i}`));
    expect(keepCandidates(list, undefined).map((c) => c.id)).toEqual(list.slice(0, KEEP_CANDIDATES).map((c) => c.id));
    const kept = keepCandidates(list, "a11");
    expect(kept).toHaveLength(KEEP_CANDIDATES);
    expect(kept.at(-1)!.id).toBe("a11");
    expect(keepCandidates([candidate("x"), candidate("x"), candidate("y")], undefined).map((c) => c.id)).toEqual(["x", "y"]);
  });

  it("adds a library image to a project for the chosen layout, with its model run", () => {
    const run = { id: "run_lib", at: "2026-10-01T00:00:00.000Z", provider: "codex", model: "chatgpt-image", task: "cover-art", promptHash: "sha256:x", outputs: ["cover.art:lib"] };
    const art: LibraryArt = { ...entry("lib", { runId: "run_lib" }), dataUrl: "data:image/png;base64,BBBB", run };
    const start = produce(p, (d) => {
      d.coverArt = { candidates: [candidate("mine")], chosenId: "mine" };
    });
    const next = produce(start, (d) => addLibraryArt(d, art, "art-panel"));
    expect(next.coverArt!.candidates.map((c) => c.id)).toEqual(["lib", "mine"]);
    expect(next.coverArt!.candidates[0]).toMatchObject({ layout: "art-panel", dataUrl: art.dataUrl, runId: "run_lib" });
    expect(next.coverArt!.candidates[0]).not.toHaveProperty("thumbUrl");
    expect(next.coverArt!.chosenId).toBe("mine");
    expect(next.modelRuns.filter((r) => r.id === "run_lib")).toHaveLength(1);
    // Adding it again moves it to the front instead of duplicating it or its run.
    const again = produce(next, (d) => addLibraryArt(d, art, "art-full-bleed"));
    expect(again.coverArt!.candidates.map((c) => c.id)).toEqual(["lib", "mine"]);
    expect(again.coverArt!.candidates[0].layout).toBe("art-full-bleed");
    expect(again.modelRuns.filter((r) => r.id === "run_lib")).toHaveLength(1);
  });
});
