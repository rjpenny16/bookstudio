import { createRng, type Rng } from "./rng";

export interface Maze {
  cols: number;
  rows: number;
  /** Wall flags per cell: bit 1 = top, 2 = right, 4 = bottom, 8 = left. */
  walls: number[];
  /** Entrance cell, on the top row (open at its top). */
  start: number;
  /** Exit cell, on the bottom row (open at its bottom). */
  end: number;
  /** Cell indices from the entrance to the exit. */
  solution: number[];
  seed: number;
}

export type MazeDifficulty = "easy" | "medium" | "hard";

const TOP = 1;
const RIGHT = 2;
const BOTTOM = 4;
const LEFT = 8;

/**
 * How often the carver extends its newest passage rather than branching
 * from a random earlier one. Branching often makes many short dead ends
 * that are easy to rule out at a glance and a short way through (easy);
 * always extending makes long winding corridors whose dead ends run deep,
 * which is what makes a maze hard for people (hard).
 */
const NEWEST: Record<MazeDifficulty, number> = { easy: 0.25, medium: 0.75, hard: 1 };

/** Perfect maze (exactly one path between any two cells), carved by a growing-tree walk. */
function carve(cols: number, rows: number, rng: Rng, difficulty: MazeDifficulty): Maze {
  const walls = new Array(cols * rows).fill(TOP | RIGHT | BOTTOM | LEFT);
  const visited = new Array(cols * rows).fill(false);
  const first = Math.floor(rng() * cols * rows);
  const active = [first];
  visited[first] = true;
  while (active.length) {
    const k = rng() < NEWEST[difficulty] ? active.length - 1 : Math.floor(rng() * active.length);
    const cur = active[k];
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    const options: [number, number, number][] = [];
    if (r > 0) options.push([cur - cols, TOP, BOTTOM]);
    if (c < cols - 1) options.push([cur + 1, RIGHT, LEFT]);
    if (r < rows - 1) options.push([cur + cols, BOTTOM, TOP]);
    if (c > 0) options.push([cur - 1, LEFT, RIGHT]);
    const unvisited = options.filter(([n]) => !visited[n]);
    if (!unvisited.length) {
      active.splice(k, 1);
      continue;
    }
    const [next, wallHere, wallThere] = unvisited[Math.floor(rng() * unvisited.length)];
    walls[cur] &= ~wallHere;
    walls[next] &= ~wallThere;
    visited[next] = true;
    active.push(next);
  }
  // Entrance somewhere along the left third of the top, exit along the right third of the bottom.
  const third = Math.max(1, Math.floor(cols / 3));
  const start = Math.floor(rng() * third);
  const end = (rows - 1) * cols + cols - 1 - Math.floor(rng() * third);
  walls[start] &= ~TOP;
  walls[end] &= ~BOTTOM;
  return { cols, rows, walls, start, end, solution: solveMaze(cols, rows, walls, start, end), seed: 0 };
}

/** Share of cells that are dead ends (three walls). */
export const deadEndShare = (m: Maze) => m.walls.filter((w, i) => i !== m.start && i !== m.end && [TOP, RIGHT, BOTTOM, LEFT].filter((b) => w & b).length === 3).length / m.walls.length;

/**
 * A maze for `difficulty`: three are carved and the one whose solution is
 * shortest (easy), middling (medium) or longest (hard) is kept, so the path
 * a solver has to trace grows with the difficulty as well as the branching.
 */
export function generateMaze(cols: number, rows: number, seed: number, difficulty: MazeDifficulty = "medium"): Maze {
  const options = [0, 1, 2].map((k) => carve(cols, rows, createRng(seed * 3 + k), difficulty)).sort((a, b) => a.solution.length - b.solution.length);
  const pick = options[difficulty === "easy" ? 0 : difficulty === "medium" ? 1 : 2];
  return { ...pick, seed };
}

export function solveMaze(cols: number, rows: number, walls: number[], start = 0, end = cols * rows - 1): number[] {
  const prev = new Array(cols * rows).fill(-1);
  prev[start] = start;
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === end) break;
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    const moves: [boolean, number][] = [
      [r > 0 && !(walls[cur] & TOP), cur - cols],
      [c < cols - 1 && !(walls[cur] & RIGHT), cur + 1],
      [r < rows - 1 && !(walls[cur] & BOTTOM), cur + cols],
      [c > 0 && !(walls[cur] & LEFT), cur - 1],
    ];
    for (const [ok, n] of moves) {
      if (ok && prev[n] === -1) {
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  if (prev[end] === -1) return [];
  const pathOut = [end];
  while (pathOut[pathOut.length - 1] !== start) pathOut.push(prev[pathOut[pathOut.length - 1]]);
  return pathOut.reverse();
}

/** SVG path data for the walls, in units of `cell` per cell. */
export function mazeWallsPath(m: Maze, cell: number): string {
  const parts: string[] = [];
  for (let i = 0; i < m.walls.length; i++) {
    const x = (i % m.cols) * cell;
    const y = Math.floor(i / m.cols) * cell;
    const w = m.walls[i];
    if (w & TOP) parts.push(`M${x} ${y}L${x + cell} ${y}`);
    if (w & LEFT) parts.push(`M${x} ${y}L${x} ${y + cell}`);
    // Right and bottom walls only on the outer edge (inner ones are the neighbour's top/left).
    if (w & RIGHT && i % m.cols === m.cols - 1) parts.push(`M${x + cell} ${y}L${x + cell} ${y + cell}`);
    if (w & BOTTOM && Math.floor(i / m.cols) === m.rows - 1) parts.push(`M${x} ${y + cell}L${x + cell} ${y + cell}`);
  }
  return parts.join("");
}

export function mazeSolutionPath(m: Maze, cell: number): string {
  if (!m.solution.length) return "";
  const pts = m.solution.map((i) => [(i % m.cols) * cell + cell / 2, Math.floor(i / m.cols) * cell + cell / 2]);
  return [`M${pts[0][0]} 0`, ...pts.map(([x, y]) => `L${x} ${y}`), `L${pts[pts.length - 1][0]} ${m.rows * cell}`].join("");
}
