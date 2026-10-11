import { describe, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { createProject } from "@/lib/schema/factory";
import { renderCoverPdf, renderInteriorPdf } from "@/lib/render/pdf";
import { nodeFontLoader } from "./helpers";

const out = process.env.SAMPLE_OUT;
describe.skipIf(!out)("sample output", () => {
  it("writes sample PDFs", async () => {
    const p = createProject({ name: "Ocean Puzzles", bookType: "puzzle", trimId: "8.5x11", paper: "white", ink: "black", bleed: false, author: "Ada Writer",
      interior: [{ kind: "title-page", title: "Ocean Puzzles", subtitle: "Word search, sudoku and mazes", author: "Ada Writer" }, { kind: "word-search", puzzles: [{ title: "Ocean", words: ["wave","shell","coral","whale","shark","tide","reef","sand","crab","anchor","island","pearl"] }], size: 15, difficulty: "medium", solutions: true, seed: 3 }, { kind: "sudoku", count: 4, difficulty: "medium", perPage: 2, solutions: true, seed: 9 }, { kind: "maze", count: 1, difficulty: "medium", solutions: false, seed: 4 }, { kind: "gratitude", count: 1 }, { kind: "daily-planner", count: 1 }, { kind: "habit-tracker", count: 1, habits: 12 }, { kind: "dot-grid", count: 1, spacingIn: 0.25 }] });
    await writeFile(`${out}/interior.pdf`, await renderInteriorPdf(p, { loadFont: nodeFontLoader }));
    await writeFile(`${out}/cover.pdf`, await renderCoverPdf(p, { loadFont: nodeFontLoader }));
  });
});
