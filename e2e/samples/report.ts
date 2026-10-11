/**
 * Node half of the sample harness: the reference books, which spreads to
 * show, and the per-book report plus the cross-book summary.
 */
import { isRecto } from "@/lib/kdp/geometry";
import { runPreflight } from "@/lib/preflight";
import { qualityReport, trimLabel } from "@/lib/quality";
import { puzzleStats, type PuzzleStats } from "@/lib/quality/puzzles";
import { scorecard } from "@/lib/quality/scorecard";
import type { Project } from "@/lib/schema/project";
import type { Spread } from "./render";

export interface SampleBook {
  id: string;
  topic: string;
  audience: string;
  bookType: Project["bookType"];
  trimId: string;
  pageTarget: number;
}

/** One book per genre the autopilot is most often asked for. Built offline, so no keys are needed and runs are comparable. */
export const SAMPLE_BOOKS: SampleBook[] = [
  { id: "seniors-sudoku", topic: "Large print sudoku puzzles for seniors", audience: "Seniors who want easy-to-read puzzles", bookType: "puzzle", trimId: "8.5x11", pageTarget: 120 },
  { id: "kids-activity", topic: "Mazes and word puzzles for kids", audience: "Kids ages 6 to 9", bookType: "activity", trimId: "8.5x11", pageTarget: 100 },
  { id: "word-search", topic: "Word search puzzles about national parks", audience: "Adult puzzle fans", bookType: "puzzle", trimId: "6x9", pageTarget: 120 },
  { id: "gratitude-journal", topic: "Daily gratitude journal", audience: "Women who want a calm five-minute morning routine", bookType: "journal", trimId: "6x9", pageTarget: 120 },
  { id: "weekly-planner", topic: "Undated weekly planner for teachers", audience: "Teachers", bookType: "planner", trimId: "7x10", pageTarget: 120 },
  { id: "bird-log", topic: "Bird watching log book", audience: "Backyard birders", bookType: "log-book", trimId: "6x9", pageTarget: 110 },
];

const MAX_SPREADS = 8;

/** The spreads worth looking at: the opening, the first spread of each body section, the answer key and the end. */
export function pickSpreads(project: Project): Spread[] {
  const pages = project.interior.pages;
  const last = pages.length - 1;
  const wanted: { index: number; label: string }[] = [{ index: 0, label: "Opening" }];
  for (const s of project.interior.sections) {
    const i = pages.findIndex((p) => p.sectionId === s.id);
    if (i >= 0 && (s.role === "body" || (s.role === "back" && "part" in s.config && s.config.part === "solutions"))) wanted.push({ index: i, label: s.label });
  }
  wanted.push({ index: last, label: "Closing" });
  const out: Spread[] = [];
  const seen = new Set<string>();
  for (const w of wanted) {
    const verso = isRecto(w.index) ? (w.index > 0 ? w.index - 1 : null) : w.index;
    const recto = isRecto(w.index) ? w.index : w.index < last ? w.index + 1 : null;
    const key = `${verso}-${recto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const nums = [verso, recto].filter((n): n is number => n !== null).map((n) => n + 1);
    out.push({ verso, recto, label: `${w.label} · p. ${nums.join("–")}` });
    if (out.length >= MAX_SPREADS) break;
  }
  return out;
}

export interface SampleReport {
  id: string;
  title: string;
  subtitle: string;
  bookType: Project["bookType"];
  trim: string;
  pages: number;
  sections: { label: string; role: string; kind: string; pages: number }[];
  cover: { templateId?: string; paletteId?: string; elements: number };
  score: number;
  scoreRows: { id: string; points: number; max: number; detail: string }[];
  preflight: { passed: number; total: number; problems: { id: string; status: string; title: string; summary: string }[] };
  quality: {
    counts: Record<"high" | "medium" | "low", number>;
    design: { area: string; severity: string; issue: string }[];
    listing: { field: string; severity: string; issue: string }[];
    content: { section: string; severity: string; message: string }[];
  };
  text: { journalPrompts: { total: number; unique: number }; affirmations: { pages: number; unique: number } };
  puzzles: PuzzleStats;
}

export function sampleReport(id: string, project: Project): SampleReport {
  const preflight = runPreflight(project);
  const quality = qualityReport(project);
  const card = scorecard(project, preflight, quality);
  const pages = project.interior.pages;
  const prompts: string[] = [];
  const affirmations: string[] = [];
  let gratitudePages = 0;
  for (const s of project.interior.sections) {
    if (s.config.kind === "journal-prompts") prompts.push(...s.config.prompts);
    if (s.config.kind === "gratitude") {
      gratitudePages += s.config.count;
      affirmations.push(...(s.config.affirmations ?? []));
    }
  }
  const norm = (t: string) => t.trim().toLowerCase();
  return {
    id,
    title: project.metadata.title,
    subtitle: project.metadata.subtitle,
    bookType: project.bookType,
    trim: trimLabel(project),
    pages: pages.length,
    sections: project.interior.sections.map((s) => ({ label: s.label, role: s.role, kind: s.config.kind, pages: pages.filter((p) => p.sectionId === s.id).length })),
    cover: { templateId: project.cover.templateId, paletteId: project.cover.paletteId, elements: project.cover.elements.length },
    score: Math.round(card.score),
    scoreRows: card.rows.map((r) => ({ id: r.id, points: Math.round(r.points * 10) / 10, max: r.max, detail: r.detail })),
    preflight: { passed: preflight.passed, total: preflight.total, problems: preflight.checks.filter((c) => c.status === "fail" || c.status === "warn").map((c) => ({ id: c.id, status: c.status, title: c.title, summary: c.summary })) },
    quality: {
      counts: quality.counts,
      design: quality.design.map((n) => ({ area: n.area, severity: n.severity, issue: n.issue })),
      listing: quality.listing.map((n) => ({ field: n.field, severity: n.severity, issue: n.issue })),
      content: quality.content.flatMap((s) => s.issues.map((i) => ({ section: s.label, severity: i.severity, message: i.message }))),
    },
    text: {
      journalPrompts: { total: prompts.length, unique: new Set(prompts.map(norm)).size },
      affirmations: { pages: gratitudePages, unique: new Set(affirmations.map(norm)).size },
    },
    puzzles: puzzleStats(project),
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function puzzleNotes(p: PuzzleStats): string {
  const notes: string[] = [];
  for (const s of p.sudoku) notes.push(`sudoku ${s.difficulty}: ${s.avgClues} clues (target ${s.targetClues}, ${pct(s.onTarget)} on target)`);
  for (const w of p.wordSearch) notes.push(`${w.kind} ${w.difficulty} ${w.size}×${w.size}: ${pct(w.directions.backward)} backward, ${pct(w.directions.diagonal)} diagonal, ${w.duplicateReads} double reads`);
  for (const m of p.maze) notes.push(`maze ${m.difficulty} ${m.cols}×${m.rows}: path ${pct(m.avgSolutionShare)} of cells, ${pct(m.avgDeadEndShare)} dead ends`);
  for (const s of p.scramble) notes.push(`scramble: ${pct(s.avgInPlace)} letters in place, ${s.anagramCollisions} anagram clashes`);
  for (const c of p.cryptogram) notes.push(`cryptogram ${c.difficulty}: ${c.avgLetters} letters, ${c.avgHints} hints`);
  return notes.join("; ") || "–";
}

/** A Markdown table across all books, small enough to paste into a PR. */
export function summaryMarkdown(reports: SampleReport[]): string {
  const rows = reports.map((r) => {
    const q = r.quality.counts;
    const text = [r.text.journalPrompts.total && `${r.text.journalPrompts.unique}/${r.text.journalPrompts.total} unique prompts`, r.text.affirmations.pages && `${r.text.affirmations.unique} affirmations for ${r.text.affirmations.pages} pages`].filter(Boolean).join(", ");
    return `| ${r.id} | ${r.trim} | ${r.pages} | **${r.score}** | ${r.preflight.passed}/${r.preflight.total} | ${q.high}/${q.medium}/${q.low} | ${r.cover.templateId ?? "–"} / ${r.cover.paletteId ?? "–"} | ${text || "–"} | ${puzzleNotes(r.puzzles)} |`;
  });
  return [
    "# Sample books",
    "",
    "Built offline by `npm run samples`. Quality findings are high/medium/low. The score includes the AI-disclosure row, which stays unconfirmed in these runs.",
    "",
    "| Book | Trim | Pages | Score | Preflight | Quality | Cover template / palette | Text | Puzzles |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/** A page that shows every book's cover, thumbnail and spreads side by side. */
export function indexHtml(reports: SampleReport[]): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const books = reports
    .map(
      (r) => `<section>
  <h2>${esc(r.title)} <small>${esc(r.id)} · ${esc(r.trim)} · ${r.pages} pages · score ${r.score}</small></h2>
  <p>${esc(r.subtitle)}</p>
  <div class="covers"><img src="${r.id}/cover-front.png" alt="Front cover" width="320"><img src="${r.id}/cover-thumb.png" alt="Thumbnail" class="thumb"><img src="${r.id}/cover-wrap.png" alt="Full wrap" width="640"></div>
  <img src="${r.id}/spreads.png" alt="Sample spreads" class="spreads">
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample books</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:24px;background:#f4f2ee;color:#222}section{margin:0 0 48px}h2 small{font-weight:400;color:#666;font-size:14px}.covers{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}.covers img{box-shadow:0 2px 8px #0003}.thumb{align-self:flex-end}.spreads{max-width:100%;margin-top:16px}</style>
</head><body><h1>Sample books</h1>
${books}
</body></html>
`;
}
