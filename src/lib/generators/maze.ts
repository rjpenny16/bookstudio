import { createRng, shuffle } from "./rng";

export interface Maze {
  cols: number;
  rows: number;
  /** Wall flags per cell: bit 1 = top, 2 = right, 4 = bottom, 8 = left. */
  walls: number[];
  /** Cell indices from entrance (top-left) to exit (bottom-right). */
  solution: number[];
  seed: number;
}

const TOP = 1;
const RIGHT = 2;
const BOTTOM = 4;
const LEFT = 8;

/** Perfect maze (exactly one path between any two cells) via iterative backtracker. */
export function generateMaze(cols: number, rows: number, seed: number): Maze {
  const rng = createRng(seed);
  const walls = new Array(cols * rows).fill(TOP | RIGHT | BOTTOM | LEFT);
  const visited = new Array(cols * rows).fill(false);
  const stack = [0];
  visited[0] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    const options: [number, number, number][] = [];
    if (r > 0) options.push([cur - cols, TOP, BOTTOM]);
    if (c < cols - 1) options.push([cur + 1, RIGHT, LEFT]);
    if (r < rows - 1) options.push([cur + cols, BOTTOM, TOP]);
    if (c > 0) options.push([cur - 1, LEFT, RIGHT]);
    const unvisited = shuffle(rng, options.filter(([n]) => !visited[n]));
    if (!unvisited.length) {
      stack.pop();
      continue;
    }
    const [next, wallHere, wallThere] = unvisited[0];
    walls[cur] &= ~wallHere;
    walls[next] &= ~wallThere;
    visited[next] = true;
    stack.push(next);
  }
  // Openings: entrance on the top of the first cell, exit on the bottom of the last.
  walls[0] &= ~TOP;
  walls[cols * rows - 1] &= ~BOTTOM;
  return { cols, rows, walls, solution: solveMaze(cols, rows, walls), seed };
}

export function solveMaze(cols: number, rows: number, walls: number[]): number[] {
  const target = cols * rows - 1;
  const prev = new Array(cols * rows).fill(-1);
  prev[0] = 0;
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) break;
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
  if (prev[target] === -1) return [];
  const pathOut = [target];
  while (pathOut[pathOut.length - 1] !== 0) pathOut.push(prev[pathOut[pathOut.length - 1]]);
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
