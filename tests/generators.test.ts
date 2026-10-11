import { describe, expect, it } from "vitest";
import { addDays, monthGrid, parseStart, startOfWeek } from "@/lib/generators/calendar";
import { decrypt, derangedAlphabet, generateCryptogram } from "@/lib/generators/cryptogram";
import { estimatePageCount, generatePages, numberSearchLists, type GeneratorConfig } from "@/lib/generators/pages";
import { scrambleWords } from "@/lib/generators/scramble";
import { DIGITS, generateWordSearch, verifyPlacement } from "@/lib/generators/wordsearch";
import { migrateProject } from "@/lib/schema/migrate";
import { createProject } from "@/lib/schema/factory";
import { parseProjectFile } from "@/lib/export/package";
import { SCHEMA_VERSION, type PrintSpec } from "@/lib/schema/project";

const spec: PrintSpec = { marketplace: "amazon-kdp", binding: "paperback", trimId: "6x9", widthIn: 6, heightIn: 9, bleed: false, paper: "white", ink: "black", coverFinish: "matte", rulesVersion: "test" };

describe("word scramble", () => {
  it("never leaves a word unscrambled and keeps the same letters", () => {
    const out = scrambleWords(["apple", "banana", "kiwi", "aa", "ox", "pepper", "apple"], 7);
    expect(out.map((o) => o.word)).toEqual(["APPLE", "BANANA", "KIWI", "PEPPER"]);
    for (const o of out) {
      expect(o.scrambled).not.toBe(o.word);
      expect([...o.scrambled].sort().join("")).toBe([...o.word].sort().join(""));
    }
  });
});

describe("cryptogram", () => {
  it("uses a derangement and decrypts back to the plaintext", () => {
    for (let seed = 1; seed < 50; seed++) {
      const key = derangedAlphabet(seed);
      expect(Object.entries(key).every(([p, c]) => p !== c)).toBe(true);
      expect(new Set(Object.values(key)).size).toBe(26);
    }
    const c = generateCryptogram("Slow and steady wins the race.", 3, 2);
    expect(decrypt(c.cipher, c.key)).toBe("SLOW AND STEADY WINS THE RACE.");
    expect(c.hints).toHaveLength(2);
  });
});

describe("number search", () => {
  it("hides only digits and every number reads correctly", () => {
    const cfg: Extract<GeneratorConfig, { kind: "number-search" }> = { kind: "number-search", count: 3, size: 14, difficulty: "medium", solutions: true, seed: 11 };
    const lists = numberSearchLists(cfg);
    expect(lists).toHaveLength(3);
    for (const [i, l] of lists.entries()) {
      expect(l.words.every((w) => /^\d+$/.test(w))).toBe(true);
      const ws = generateWordSearch(l.words, cfg.size, cfg.difficulty, cfg.seed + i, DIGITS);
      expect(ws.grid.flat().every((ch) => DIGITS.includes(ch))).toBe(true);
      expect(ws.placed.every((p) => verifyPlacement(ws, p))).toBe(true);
    }
  });
});

describe("calendar", () => {
  it("builds month grids in whole Monday-first weeks", () => {
    const oct = parseStart("2026-10")!;
    const cells = monthGrid(oct);
    expect(cells.length % 7).toBe(0);
    expect(cells.indexOf(1)).toBe(3); // 1 Oct 2026 is a Thursday
    expect(cells.filter((c) => c !== null)).toHaveLength(31);
    expect(startOfWeek(addDays(oct, 4)).getUTCDate()).toBe(5);
    expect(parseStart("")).toBeNull();
    expect(parseStart("2026-13")).toBeNull();
  });
});

describe("page estimates match generated pages exactly", () => {
  const configs: GeneratorConfig[] = [
    { kind: "sudoku", count: 13, difficulty: "easy", perPage: 2, solutions: true, seed: 1 },
    { kind: "sudoku", count: 13, difficulty: "easy", perPage: 2, solutions: true, seed: 1, part: "puzzles" },
    { kind: "sudoku", count: 13, difficulty: "easy", perPage: 2, solutions: true, seed: 1, part: "solutions" },
    { kind: "number-search", count: 5, size: 14, difficulty: "easy", solutions: true, seed: 2, part: "solutions" },
    { kind: "maze", count: 6, difficulty: "easy", solutions: true, seed: 3 },
    { kind: "word-scramble", puzzles: [{ title: "Fruit", words: ["apple", "pear", "plum", "grape"] }, { title: "Pets", words: ["dog", "cat", "rabbit"] }, { title: "Empty", words: ["aa"] }], solutions: true, seed: 4 },
    { kind: "cryptogram", phrases: ["Many hands make light work.", "Practice makes perfect.", "Better late than never."], difficulty: "easy", perPage: 2, solutions: true, seed: 5 },
    { kind: "text-page", title: "How to Use", body: "Hello.\n\nSecond paragraph." },
    { kind: "section-divider", title: "Part One", subtitle: "Warm-up" },
    { kind: "table-of-contents", entries: [{ title: "Part One", page: 5 }] },
    { kind: "monthly-calendar", count: 3, startDate: "2026-01" },
    { kind: "weekly-spread", count: 4, startDate: "" },
    { kind: "gratitude", count: 3, affirmations: ["I notice the good things around me."] },
  ];
  it.each(configs.map((c) => [c.kind + ("part" in c && c.part ? `:${c.part}` : ""), c] as const))("%s", (_, cfg) => {
    expect(generatePages(cfg, { spec, pageCountHint: 100 })).toHaveLength(estimatePageCount(cfg));
  });
});

describe("schema 1.1 migration", () => {
  it("upgrades 1.0 projects by adding empty sections", () => {
    const p = createProject({ name: "Old", bookType: "notebook", trimId: "6x9", paper: "white", ink: "black", bleed: false });
    const old = { ...p, schemaVersion: "1.0", interior: { pages: p.interior.pages, pageNumbers: p.interior.pageNumbers } } as unknown as typeof p;
    const up = migrateProject(old);
    expect(up.schemaVersion).toBe(SCHEMA_VERSION);
    expect(up.interior.sections).toEqual([]);
    expect(parseProjectFile(JSON.stringify(old)).interior.sections).toEqual([]);
    expect(() => parseProjectFile(JSON.stringify({ ...old, schemaVersion: "9.9" }))).toThrow();
  });
});
