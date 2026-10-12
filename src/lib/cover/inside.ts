import { puzzleCount } from "@/lib/generators/pages";
import type { Project } from "@/lib/schema/project";

const NOUN: Record<string, [string, string]> = {
  "journal-prompts": ["prompt page", "prompt pages"],
  lined: ["lined page", "lined pages"],
  gratitude: ["gratitude page", "gratitude pages"],
  "daily-planner": ["daily planner page", "daily planner pages"],
  "weekly-spread": ["weekly planner page", "weekly planner pages"],
  "monthly-calendar": ["monthly calendar", "monthly calendars"],
  "habit-tracker": ["habit tracker", "habit trackers"],
  log: ["log page", "log pages"],
  "dot-grid": ["dot grid page", "dot grid pages"],
  graph: ["graph paper page", "graph paper pages"],
  sudoku: ["sudoku puzzle", "sudoku puzzles"],
  "word-search": ["word search", "word searches"],
  "number-search": ["number search", "number searches"],
  maze: ["maze", "mazes"],
  "word-scramble": ["word scramble", "word scrambles"],
  cryptogram: ["cryptogram", "cryptograms"],
  coloring: ["coloring page", "coloring pages"],
};

/** Page kinds that aren't content worth listing or showing on the back. */
export const NOT_CONTENT = new Set(["section-divider", "title-page", "belongs-to", "table-of-contents", "blank", "text-page"]);

/** Short "What's inside" bullets for the back cover, built from the interior's sections. */
export function whatsInside(project: Project, max = 5): string[] {
  const pages = project.interior.pages;
  const items: string[] = [];
  let answerKeys = false;
  for (const s of project.interior.sections) {
    const kind = s.config.kind;
    if (s.role === "front" || NOT_CONTENT.has(kind)) continue;
    if ("part" in s.config && s.config.part === "solutions") {
      answerKeys = true;
      continue;
    }
    if (s.role === "back" && !NOUN[kind]) continue;
    const n = puzzleCount(s.config) || pages.filter((p) => p.sectionId === s.id).length;
    if (!n || !NOUN[kind] || (s.role === "back" && n < 6)) continue;
    const noun = NOUN[kind][n === 1 ? 0 : 1];
    const d = "difficulty" in s.config ? s.config.difficulty : undefined;
    const level = d && !s.label.toLowerCase().includes(d) ? ` (${d})` : "";
    items.push(s.role === "back" ? `${n} ${noun} for notes` : `${s.label}: ${n} ${noun}${level}`);
  }
  // Pages added by hand (outside any section) are summarized by page type.
  const sectionIds = new Set(project.interior.sections.map((s) => s.id));
  const kinds = new Map<string, number>();
  for (const p of pages) {
    const k = p.generator?.kind;
    if (k && NOUN[k] && !(p.sectionId && sectionIds.has(p.sectionId))) kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  for (const [k, c] of kinds) items.push(`${c} ${NOUN[k][c === 1 ? 0 : 1]}`);
  const out = items.slice(0, answerKeys ? max - 1 : max);
  if (answerKeys) out.push("Answer keys at the back");
  return out;
}

/** Volume number from the series field ("Brain Teasers, Book 2", "Vol. 3"). */
export function seriesVolume(series: string): string | undefined {
  return /(?:vol(?:ume)?\.?|book|no\.?|#|part)\s*(\d{1,3})\b/i.exec(series)?.[1];
}

/** Series name without the volume part: "Brain Breaks, Book 2" -> "Brain Breaks". */
export function seriesName(series: string): string {
  return series.replace(/[,:\-–—\s]*(?:vol(?:ume)?\.?|book|no\.?|#|part)\s*\d{1,3}\b.*$/i, "").trim();
}

/**
 * Default badge for templates that have one: the puzzle count for puzzle
 * books, "Large print" when the title says so, else nothing.
 */
export function coverBadge(project: Project): string {
  const puzzles = project.interior.sections.reduce((n, s) => n + (s.role === "body" && !("part" in s.config && s.config.part === "solutions") ? puzzleCount(s.config) : 0), 0);
  if (puzzles >= 10) return `${puzzles} puzzles`;
  if (/large[\s-]print/i.test(`${project.metadata.title} ${project.metadata.subtitle}`)) return "Large print";
  return "";
}
