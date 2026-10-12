import { describe, expect, it } from "vitest";
import { planSections } from "@/lib/agent/blueprint";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { deadEndShare, generateMaze } from "@/lib/generators/maze";
import { scrambleWords } from "@/lib/generators/scramble";
import { findReads, generateWordSearch, type WordSearch } from "@/lib/generators/wordsearch";

const WORDS = ["canyon", "glacier", "geyser", "forest", "river", "valley", "summit", "meadow", "prairie", "boulder", "cavern", "waterfall", "ridge", "trail", "lake"];

/** Cells shared by two or more placed words. */
function crossings(ws: WordSearch): number {
  const seen = new Map<string, number>();
  for (const p of ws.placed) for (let k = 0; k < p.word.length; k++) {
    const key = `${p.row + p.dr * k},${p.col + p.dc * k}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.values()].filter((n) => n > 1).length;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("word search difficulty", () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i * 37 + 5);

  it("every listed word can be found exactly once", () => {
    for (const d of ["easy", "medium", "hard"] as const)
      for (const seed of seeds) {
        const ws = generateWordSearch(WORDS, 15, d, seed);
        for (const p of ws.placed) expect(findReads(ws.grid, p.word).length, `${d} ${seed} ${p.word}`).toBe(p.word === [...p.word].reverse().join("") ? 2 : 1);
      }
  });

  it("leaves out a word hidden inside another, even backwards", () => {
    const ws = generateWordSearch(["tractor", "car", "barn", "napkin", "pan", "hay"], 12, "medium", 3);
    expect(ws.skipped.sort()).toEqual(["car", "pan"]);
    expect(ws.placed.map((p) => p.word).sort()).toEqual(["BARN", "HAY", "NAPKIN", "TRACTOR"]);
  });

  it("medium includes backwards words; easy only reads forwards and down", () => {
    const backwards = (d: "easy" | "medium") => seeds.flatMap((s) => generateWordSearch(WORDS, 15, d, s).placed).filter((p) => p.dr < 0 || p.dc < 0).length;
    expect(backwards("easy")).toBe(0);
    expect(backwards("medium")).toBeGreaterThan(0);
  });

  it("hard grids cross their words more than easy ones", () => {
    const easy = avg(seeds.map((s) => crossings(generateWordSearch(WORDS, 15, "easy", s))));
    const hard = avg(seeds.map((s) => crossings(generateWordSearch(WORDS, 15, "hard", s))));
    expect(hard).toBeGreaterThan(easy);
  });

  it("hard filler leans on the words' own letters as decoys", () => {
    const share = (d: "easy" | "hard") =>
      avg(
        seeds.map((s) => {
          const ws = generateWordSearch(WORDS, 15, d, s);
          const letters = new Set(ws.placed.map((p) => p.word).join(""));
          const flat = ws.grid.flat();
          return flat.filter((c) => letters.has(c)).length / flat.length;
        }),
      );
    expect(share("hard")).toBeGreaterThan(share("easy"));
  });

  it("grids grow with difficulty on every trim", () => {
    for (const [trimId, topic, audience] of [["6x9", "word search puzzles", "adults"], ["8.5x11", "word search puzzles", "adults"], ["8.5x11", "large print word search", "seniors"]] as const) {
      const bp = recipeBlueprint({ bookType: "puzzle", topic, audience, notes: "" });
      const sizes = new Map<string, number>();
      for (const s of planSections(bp, { bookType: "puzzle", topic, audience, notes: "", trimId, pageTarget: 140 })) if (s.config.kind === "word-search") sizes.set(s.config.difficulty, s.config.size);
      const [e, m, h] = (["easy", "medium", "hard"] as const).map((d) => sizes.get(d));
      if (e && m) expect(m, trimId).toBeGreaterThan(e);
      if (m && h) expect(h, trimId).toBeGreaterThan(m);
    }
  });
});

describe("maze difficulty", () => {
  it("hard mazes wind a much longer way through, with fewer obvious dead ends", () => {
    const mazes = (d: "easy" | "hard") => Array.from({ length: 8 }, (_, i) => generateMaze(16, 20, i + 1, d));
    const path = (d: "easy" | "hard") => avg(mazes(d).map((m) => m.solution.length / (m.cols * m.rows)));
    expect(path("hard")).toBeGreaterThan(path("easy") * 2);
    expect(avg(mazes("easy").map(deadEndShare))).toBeGreaterThan(avg(mazes("hard").map(deadEndShare)));
  });

  it("entrances and exits move along the edges", () => {
    const starts = new Set(Array.from({ length: 10 }, (_, i) => generateMaze(18, 18, i, "medium").start));
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe("scramble difficulty", () => {
  const words = ["planet", "comet", "galaxy", "nebula", "orbit", "rocket", "asteroid", "meteor"];
  const inPlace = (w: string, s: string) => [...s].filter((ch, k) => w[k] === ch).length;

  it("easy keeps the first letter as a hint", () => {
    for (const s of scrambleWords(words, 3, "easy")) {
      expect(s.scrambled[0]).toBe(s.word[0]);
      expect(s.scrambled).not.toBe(s.word);
    }
  });

  it("medium leaves at most 40% of letters in place and hard moves them all", () => {
    for (const s of scrambleWords(words, 5, "medium")) expect(inPlace(s.word, s.scrambled)).toBeLessThanOrEqual(Math.floor(s.word.length * 0.4));
    for (const s of scrambleWords(words, 5, "hard")) expect(inPlace(s.word, s.scrambled)).toBe(0);
  });

  it("never scrambles into another word on the list", () => {
    const anagrams = ["listen", "silent", "enlist", "tinsel"];
    for (const d of ["easy", "medium", "hard"] as const)
      for (const s of scrambleWords(anagrams, 9, d)) expect(anagrams.map((w) => w.toUpperCase())).not.toContain(s.scrambled);
  });
});
