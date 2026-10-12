import type { Box } from "@/lib/kdp/geometry";
import { pattern, rect, text } from "@/lib/schema/elements";
import type { Element } from "@/lib/schema/project";

/**
 * A 9 x 9 piece of one of the book's own puzzles for its cover: the sudoku
 * clues or the word-search letters a buyer will actually solve, instead of a
 * decorative grid. Cells are read row by row; "" is an empty cell.
 */
export interface CoverMotif {
  kind: "digits" | "letters";
  cells: string[];
  /** Draw the 3 x 3 blocks (sudoku). */
  blocks: boolean;
}

/** The motif drawn in `box` (a square): cells, grid lines (with 3 x 3 blocks for sudoku), and a border. */
export function motifGrid(m: CoverMotif, box: Box, o: { line: string; ink: string; fill?: string | null; family: string; border?: number }): Element[] {
  const cell = box.width / 9;
  const els: Element[] = [];
  if (o.fill) els.push(rect({ ...box, fill: o.fill, name: "Motif background" }));
  els.push(pattern({ ...box, pattern: { kind: "grid", spacing: cell, ...(m.blocks ? { majorEvery: 3 } : {}) }, stroke: o.line, strokeWidth: Math.max(0.6, cell * 0.04), name: "Motif grid" }));
  els.push(rect({ ...box, fill: null, stroke: o.line, strokeWidth: o.border ?? Math.max(1.5, cell * 0.08), name: "Motif border" }));
  const size = cell * (m.kind === "digits" ? 0.62 : 0.56);
  m.cells.slice(0, 81).forEach((c, i) => {
    if (!c) return;
    const x = box.x + (i % 9) * cell;
    const y = box.y + Math.floor(i / 9) * cell + (cell - size * 1.13) / 2;
    els.push(text({ x, y, width: cell, height: size * 1.13, text: c, fontFamily: o.family, bold: true, fontSize: size, color: o.ink, align: "center", lineHeight: 1, name: "Motif cell" }));
  });
  return els;
}
