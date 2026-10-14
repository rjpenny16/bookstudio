import { OFFLINE_MYSTERIES, offlineMystery } from "@/lib/ai/offlineMysteries";
import { THEME_BANK } from "@/lib/ai/offlineBanks";
import { MYSTERY_CLUE_KINDS, type MysteryChapterOutput, type MysteryClueKind, type MysteryPlanOutput, type TaskInput, type TaskOutput } from "@/lib/ai/tasks";
import { generateCrossword, normalizeAnswer, type CrosswordEntry } from "@/lib/generators/crossword";
import { estimatePageCount, generatorBox, storyPagesNeeded, type GeneratorConfig } from "@/lib/generators/pages";
import { randomSeed } from "@/lib/generators/rng";
import { secretOrder } from "@/lib/generators/scramble";
import { interiorStyle, type InteriorStyle } from "@/lib/generators/style";
import { generateWordSearch, LETTERS, normalizeWord } from "@/lib/generators/wordsearch";
import { findTrim } from "@/lib/kdp/geometry";
import { lineAdvance } from "@/lib/render/textLayout";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { cleanCrossword, cleanWordList } from "@/lib/quality/content";
import type { SectionInput } from "@/lib/schema/factory";
import type { PrintSpec } from "@/lib/schema/project";
import { clampPageTarget, MIN_PAGES, puzzleConfig, puzzleContent, type Sizing } from "./blueprint";

/**
 * Murder mystery books: a story in chapters, each ending in puzzles whose
 * answers are the clues that solve the case. The book stands on its plan,
 * so the plan comes first and is checked for fair play before a word of
 * story is written: a culprit among the suspects, enough clues against
 * them, every innocent suspect cleared, and every clue in a form its
 * puzzle can hide. Chapters are then written to the plan, checked, and
 * laid out with the puzzles, case notes, an accusation page, the answer
 * key and a sealed solution.
 */

export type MysteryPlan = MysteryPlanOutput;
export type MysteryClue = MysteryPlan["chapters"][number]["clues"][number];
type Difficulty = "easy" | "medium" | "hard";

export interface MysteryInput {
  topic: string;
  audience: string;
  notes: string;
  angle: string;
  title: string;
  trimId: string;
  pageTarget: number;
  difficulty: Difficulty;
}

const KIDS = /\b(kid|kids|child|children|ages? \d|boys?|girls?|tweens?|middle grade)\b/i;
const LARGE = /large print|senior|elderly|low vision|grandparent|retire/i;

/* --------------------------------- sizing --------------------------------- */

export interface MysterySizing {
  chapters: number;
  cluesPerChapter: number;
  /** Story pages a chapter is written for. */
  storyPages: number;
  /** About how many words that is. */
  wordsPerChapter: number;
  kinds: MysteryClueKind[];
  difficulty: Difficulty;
  largePrint: boolean;
  kids: boolean;
  /** Longest crossword answer the grids hold. */
  maxAnswer: number;
  sizing: Sizing;
  style: InteriorStyle;
  spec: PrintSpec;
}

export function specFor(trimId: string): PrintSpec {
  const t = findTrim(trimId) ?? findTrim("8.5x11")!;
  return { marketplace: "amazon-kdp", binding: "paperback", trimId: t.id, widthIn: t.widthIn, heightIn: t.heightIn, bleed: false, paper: "white", ink: "black", coverFinish: "matte", rulesVersion: RULES_VERSION };
}

/** The interior style a mystery is laid out in (kids' mysteries wear the kids' look). */
export function mysteryStyle(i: { audience: string; topic: string; notes?: string }): { genre: "kids" | "mystery"; largePrint: boolean } {
  const words = `${i.audience} ${i.topic} ${i.notes ?? ""}`;
  return { genre: KIDS.test(words) ? "kids" : "mystery", largePrint: LARGE.test(words) };
}

/** Pages outside the chapters: title, how to solve, suspects, case notes, contents; final deduction, accusation, key divider, deduction key, solution divider, closing. */
const FIXED_PAGES = 5 + 6;

/** Rough page count of a plan's shape (the exact count is measured once the chapters are written). */
const shapePages = (chapters: number, clues: number, story: number) => FIXED_PAGES + chapters * (story + clues) + Math.ceil((chapters * clues) / 4) + 3 + Math.max(2, story);

/**
 * How many chapters, clues per chapter and story pages fill the page
 * target best. Readers like a good number of chapters (8 to 12) more than
 * very long ones, so ties go to more chapters.
 */
export function mysterySizing(i: Pick<MysteryInput, "trimId" | "pageTarget" | "audience" | "topic" | "notes" | "difficulty">): MysterySizing {
  const target = clampPageTarget(i.pageTarget);
  const { genre, largePrint } = mysteryStyle(i);
  const kids = genre === "kids";
  const spec = specFor(i.trimId);
  const style = interiorStyle({ genre, largePrint });
  const sizing: Sizing = { largePrint, wideTrim: spec.widthIn >= 7.5 };
  let best = { chapters: 8, clues: 1, story: 1, score: Infinity };
  for (let story = 1; story <= 4; story++)
    for (let clues = 1; clues <= 2; clues++)
      for (let chapters = 6; chapters <= 14; chapters++) {
        const pages = shapePages(chapters, clues, story);
        // Short of the target is padded with notes pages; over it costs more (the book runs long).
        const miss = pages <= target ? target - pages : (pages - target) * 3;
        const score = miss + Math.abs(chapters - 10) * 0.6 + (clues - 1) * 0.5 + story * 0.2;
        if (score < best.score) best = { chapters, clues, story, score };
      }
  // Words per story page, from the page's measure at body size (first page loses room to the heading).
  const box = generatorBox(spec, target);
  const size = style.sizes.body;
  const words = Math.round(((box.height / lineAdvance(size, 1.42)) * (box.width / (size * 0.48)) * 0.78) / 6);
  const difficulty: Difficulty = kids ? "easy" : i.difficulty;
  const crossword = puzzleConfig("crossword", 1, difficulty, sizing);
  return {
    chapters: best.chapters,
    cluesPerChapter: best.clues,
    storyPages: best.story,
    wordsPerChapter: Math.max(150, Math.round(words * best.story * 0.9 / 10) * 10),
    kinds: kids ? ["word-search", "crossword", "word-scramble"] : [...MYSTERY_CLUE_KINDS],
    difficulty,
    largePrint,
    kids,
    maxAnswer: crossword.kind === "crossword" ? Math.min(10, crossword.size - 2) : 10,
    sizing,
    style,
    spec,
  };
}

/* ------------------------------ the plan check ----------------------------- */

const lettersOf = (s: string) => normalizeWord(s);
const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/** A clue's answer tidied for its puzzle kind: capitals, and only what the puzzle can show. */
export function tidyAnswer(kind: MysteryClueKind, answer: string): string {
  const up = answer.toUpperCase().replace(/[’']/g, "");
  if (kind === "cryptogram") return up.replace(/[^A-Z ,.!?-]/g, " ").replace(/\s+/g, " ").trim();
  if (kind === "word-search") return up.replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  return lettersOf(up);
}

/** Why an answer can't be hidden in its puzzle, or null. */
export function answerProblem(kind: MysteryClueKind, answer: string, maxAnswer: number): string | null {
  const n = lettersOf(answer).length;
  switch (kind) {
    case "word-search":
      return n < 6 || n > 24 ? `a word-search clue needs 6-24 letters (has ${n})` : null;
    case "crossword":
      return /\s/.test(answer) ? "a crossword clue must be one word" : n < 3 || n > maxAnswer ? `a crossword clue needs 3-${maxAnswer} letters (has ${n})` : null;
    case "word-scramble":
      return /\s/.test(answer) ? "a scramble clue must be one word" : n < 3 || n > 9 ? `a scramble clue needs 3-9 letters (has ${n})` : /[JQXZ]/.test(answer) ? "a scramble clue should avoid J, Q, X and Z" : null;
    case "cryptogram":
      return answer.length < 20 || answer.length > 110 ? `a cryptogram clue needs 20-110 characters (has ${answer.length})` : null;
  }
}

export interface PlanCheck {
  plan: MysteryPlan;
  /** What breaks the fair-play or puzzle rules, in words a writer can act on. */
  problems: string[];
  /** Problems no amount of tidying fixes: no culprit, too few chapters or clues. */
  fatal: boolean;
}

/**
 * Check a case plan: tidy what can be tidied (names matched to the cast,
 * answers set in capitals) and list everything that breaks the rules of a
 * fair mystery or can't be hidden in its puzzle.
 */
export function checkMysteryPlan(raw: MysteryPlan, z: Pick<MysterySizing, "kinds" | "maxAnswer">): PlanCheck {
  const problems: string[] = [];
  const plan: MysteryPlan = structuredClone(raw);
  plan.suspects = plan.suspects.filter((s) => s.name.trim());
  const names = plan.suspects.map((s) => s.name.trim());
  if (names.length < 3 || names.length > 7) problems.push(`The case needs 4-6 suspects (has ${names.length}).`);
  if (new Set(names.map((n) => n.toLowerCase())).size < names.length) problems.push("Two suspects share a name.");
  const culprit = names.find((n) => sameName(n, plan.culprit));
  if (!culprit) problems.push(`The culprit "${plan.culprit}" is not one of the suspects.`);
  else plan.culprit = culprit;
  plan.chapters = plan.chapters.filter((c) => c.title.trim() || c.summary.trim()).slice(0, 16);
  if (plan.chapters.length < 4) problems.push(`The story needs at least 6 chapters (has ${plan.chapters.length}).`);

  // Name parts that would give a suspect away if they appeared in a clue.
  const nameParts = names.flatMap((n) => n.split(/\s+/)).map((p) => lettersOf(p)).filter((p) => p.length >= 4 && !["MISS", "MRS", "CAPTAIN", "DOCTOR", "LADY", "LORD", "INSPECTOR"].includes(p));
  const seen = new Set<string>();
  let valid = 0;
  plan.chapters.forEach((ch, c) => {
    if (!ch.clues.length) problems.push(`Chapter ${c + 1} ("${ch.title}") has no clue.`);
    ch.clues.forEach((cl, k) => {
      const where = `Chapter ${c + 1} clue ${k + 1}`;
      // Checked before tidying, which closes up the spaces.
      const words = cl.answer.trim().split(/\s+/).length;
      cl.answer = tidyAnswer(cl.kind, cl.answer);
      const suspect = cl.suspect.trim() ? names.find((n) => sameName(n, cl.suspect)) : "";
      if (suspect === undefined) problems.push(`${where} is about "${cl.suspect}", who is not a suspect.`);
      cl.suspect = suspect ?? "";
      if (!cl.suspect) cl.effect = "neutral";
      let bad = false;
      if (!z.kinds.includes(cl.kind)) {
        problems.push(`${where} uses a ${cl.kind}; use only ${z.kinds.join(", ")}.`);
        bad = true;
      }
      const ap = (cl.kind === "crossword" || cl.kind === "word-scramble") && words > 1 ? `a ${cl.kind} clue must be one word` : answerProblem(cl.kind, cl.answer, z.maxAnswer);
      if (ap) {
        problems.push(`${where} ("${cl.answer}"): ${ap}.`);
        bad = true;
      }
      const letters = lettersOf(cl.answer);
      // A coded sentence may mention someone ("THE COOK SAW BRIGGS..."); a one-word or hidden clue that is a name gives the game away.
      if (cl.kind !== "cryptogram" && nameParts.some((p) => new RegExp(`\\b${p}\\b`).test(cl.answer.toUpperCase()))) {
        problems.push(`${where} ("${cl.answer}") names a suspect; the clue should be the evidence, not the name.`);
        bad = true;
      }
      if (seen.has(letters)) {
        problems.push(`${where} repeats the answer "${cl.answer}".`);
        bad = true;
      }
      seen.add(letters);
      if (!bad) valid++;
    });
  });
  if (valid < 4) problems.push(`The case needs more usable clues (has ${valid}).`);

  // Fair play: enough against the culprit, nothing for them, and every innocent cleared.
  const clues = plan.chapters.flatMap((ch, c) => ch.clues.map((cl) => ({ ...cl, chapter: c })));
  if (culprit) {
    const against = clues.filter((cl) => cl.suspect === culprit && cl.effect === "implicates");
    if (against.length < 2) problems.push(`Only ${against.length} clue(s) point at the culprit, ${culprit}; give at least 3 (motive, opportunity or a broken alibi, and physical evidence).`);
    if (against.length && against.every((cl) => cl.chapter < plan.chapters.length / 2)) problems.push(`Every clue against ${culprit} comes in the first half; save the decisive one for late in the book.`);
    if (clues.some((cl) => cl.suspect === culprit && cl.effect === "clears")) problems.push(`A clue clears the culprit, ${culprit}; a fair mystery never clears the guilty party.`);
    for (const n of names.filter((x) => x !== culprit))
      if (!clues.some((cl) => cl.suspect === n && cl.effect === "clears")) problems.push(`Nothing clears ${n}; every innocent suspect needs a clue that rules them out.`);
    // The first quarter gathers neutral facts; nothing there points at the killer.
    const quarter = Math.max(1, Math.ceil(plan.chapters.length / 4));
    for (const cl of against.filter((x) => x.chapter < quarter)) problems.push(`Chapter ${cl.chapter + 1}'s clue "${cl.answer}" points at the culprit too early; the first ${quarter} chapter(s) should give neutral facts (places, times, objects).`);
    storyChecks(plan, names, culprit, clues, nameParts, problems);
  }
  for (const cl of clues) if (cl.source.trim().length < 8) problems.push(`Chapter ${cl.chapter + 1}'s clue "${cl.answer}" needs a source: the thing in the story the puzzle comes from.`);
  const fatal = !culprit || plan.chapters.length < 4 || valid < 4;
  return { plan, problems, fatal };
}

/** Minutes after midnight for "HH:MM", or null. */
export function clockMinutes(t: string): number | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Two place names for the same spot ("the study", "Study", "Sir Edmund's study"). */
const samePlace = (a: string, b: string) => {
  const n = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9 ]/g, "").trim();
  const x = n(a);
  const y = n(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * The checks on the story behind the clues: every innocent suspect has a
 * secret that explains their suspicious behavior; the true timeline is
 * possible (nobody in two places at once), gives every innocent suspect an
 * alibi at the time of death and puts the culprit at the scene; the wrong
 * theory peaks mid-book and is cleared after the halfway point; and the
 * final deduction can be spelled from the clues' letters.
 */
function storyChecks(plan: MysteryPlan, names: string[], culprit: string, clues: (MysteryClue & { chapter: number })[], nameParts: string[], problems: string[]) {
  const innocent = names.filter((n) => n !== culprit);
  for (const s of plan.suspects) if (s.name !== culprit && (s.secret ?? "").trim().length < 12) problems.push(`${s.name} needs a secret that isn't the murder but explains why they act guilty.`);

  // Timeline.
  const people = [...names, plan.victim.name];
  const tod = clockMinutes(plan.timeOfDeath);
  if (tod === null) problems.push(`timeOfDeath "${plan.timeOfDeath}" must be HH:MM on a 24-hour clock.`);
  if (!plan.crimeScene.trim()) problems.push("Name the crime scene.");
  if (plan.timeline.length < 6) problems.push(`The timeline needs the victim and every suspect around the death (has ${plan.timeline.length} entries).`);
  const at = new Map<string, string>();
  for (const e of plan.timeline) {
    const who = people.find((n) => sameName(n, e.who));
    const t = clockMinutes(e.time);
    if (!who) problems.push(`Timeline: "${e.who}" is not the victim or a suspect.`);
    else e.who = who;
    if (t === null) problems.push(`Timeline: "${e.time}" must be HH:MM.`);
    if (!who || t === null) continue;
    const key = `${who}@${t}`;
    const was = at.get(key);
    if (was !== undefined && !samePlace(was, e.where)) problems.push(`Timeline: ${who} is in two places at ${e.time} (${was} and ${e.where}).`);
    at.set(key, e.where);
  }
  if (tod !== null && plan.crimeScene.trim()) {
    const near = (t: number) => Math.min(Math.abs(t - tod), 1440 - Math.abs(t - tod));
    for (const n of innocent) {
      const e = plan.timeline.find((x) => x.who === n && clockMinutes(x.time) === tod);
      if (!e) problems.push(`Timeline: where is ${n} at ${plan.timeOfDeath}, the time of death? Every innocent suspect needs an entry then.`);
      else if (samePlace(e.where, plan.crimeScene)) problems.push(`Timeline: ${n} is at the crime scene at the time of death but is innocent.`);
    }
    if (!plan.timeline.some((x) => x.who === culprit && samePlace(x.where, plan.crimeScene) && near(clockMinutes(x.time) ?? -9999) <= 60))
      problems.push(`Timeline: the culprit, ${culprit}, must be at ${plan.crimeScene} within an hour of ${plan.timeOfDeath}.`);
  }

  // The wrong theory: an innocent suspect, implicated before 60% of the book and cleared after the halfway point.
  const n = plan.chapters.length;
  const ft = names.find((x) => sameName(x, plan.falseTheory.suspect));
  if (!ft || ft === culprit) problems.push(`falseTheory must name an innocent suspect (has "${plan.falseTheory.suspect}").`);
  else {
    plan.falseTheory.suspect = ft;
    if (!clues.some((cl) => cl.suspect === ft && cl.effect === "implicates" && cl.chapter < n * 0.6)) problems.push(`The wrong theory against ${ft} needs a clue that implicates them before 60% of the book.`);
    if (!clues.some((cl) => cl.suspect === ft && cl.effect === "clears" && cl.chapter >= Math.floor(n / 2))) problems.push(`The clue that clears ${ft} should come after the halfway point, so the wrong theory holds through the middle.`);
  }

  // The final deduction is spelled from letters of the clues.
  const oneWord = !/\s/.test(plan.finalProof.answer.trim());
  const proof = lettersOf(plan.finalProof.answer);
  plan.finalProof.answer = proof;
  if (!oneWord || proof.length < 4 || proof.length > 12) problems.push(`finalProof "${plan.finalProof.answer}" must be one word of 4-12 letters.`);
  if (nameParts.includes(proof)) problems.push("finalProof must name where the proof is, not a person.");
  if (clues.some((cl) => lettersOf(cl.answer) === proof)) problems.push("finalProof must be new, not one of the clue answers.");
  const pool = clues.map((cl) => lettersOf(cl.answer)).join("");
  const missing = [...new Set(proof)].filter((ch) => !pool.includes(ch));
  if (missing.length) problems.push(`finalProof "${proof}" can't be spelled from the clues: no clue has the letter(s) ${missing.join(", ")}.`);
}

/**
 * Which letter of which clue spells each letter of the final proof: clue
 * numbers are 1-based through the book, letters count letters only. Picks
 * favor early letters (easy to count), spread across the book and use each
 * clue once where they can.
 */
export function deductionPicks(answers: string[], proof: string): { clue: number; letter: number }[] | null {
  const words = answers.map((a) => lettersOf(a));
  const target = lettersOf(proof);
  const used = new Set<number>();
  const picks: { clue: number; letter: number }[] = [];
  for (let i = 0; i < target.length; i++) {
    // Early letters are easy to count: the clue where this letter comes soonest wins, an unused clue near this
    // letter's share of the book breaking ties, so the picks spread through the book.
    const home = (i * words.length) / target.length;
    const cost = (k: number) => words[k].indexOf(target[i]) * 2 + (used.has(k) ? 30 : 0) + Math.abs(k - home) * 0.5;
    const candidates = words.map((_, k) => k).filter((k) => words[k].includes(target[i]));
    if (!candidates.length) return null;
    const pick = candidates.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    used.add(pick);
    picks.push({ clue: pick + 1, letter: words[pick].indexOf(target[i]) + 1 });
  }
  return picks;
}

/** What a reader can see by each checkpoint: the clues found so far, never who is guilty. */
export function testCheckpoints(plan: MysteryPlan): TaskInput<"mystery-test">["checkpoints"] {
  const n = plan.chapters.length;
  return [0.25, 0.5, 0.75, 1].map((share) => ({
    label: `${Math.round(share * 100)}%`,
    clues: plan.chapters.slice(0, Math.max(1, Math.ceil(n * share))).flatMap((ch, c) => ch.clues.map((cl) => `Chapter ${c + 1} (${cl.source}): ${cl.answer}. ${cl.reveals}`)),
  }));
}

/**
 * Judge a test reader's verdicts: a confident correct accusation at 25% or
 * 50% means the killer is too easy to spot; at the end the clues must lead
 * a careful reader to the culprit.
 */
export function judgeTest(verdicts: TaskOutput<"mystery-test">["verdicts"], culprit: string): string[] {
  const problems: string[] = [];
  const by = (label: string) => verdicts.find((v) => v.checkpoint.trim() === label);
  for (const label of ["25%", "50%"]) {
    const v = by(label);
    if (v && sameName(v.suspect, culprit) && v.confidence >= 4) problems.push(`A test reader confidently named ${culprit} at ${label} of the book ("${v.reasoning.trim()}"); the early clues give the killer away. Make them neutral or point them elsewhere.`);
  }
  const end = by("100%");
  if (end && (!sameName(end.suspect, culprit) || end.confidence < 3)) problems.push(`With every clue in hand, a test reader accused ${end.suspect} (confidence ${end.confidence}/5), not ${culprit}: "${end.reasoning.trim()}". Strengthen the late clues against the culprit and make sure each innocent suspect is clearly cleared.`);
  return problems;
}

/** Drop the clues that can't be hidden (wrong kind or answer), so a plan with small faults can still be built. */
function usableClues(plan: MysteryPlan, z: Pick<MysterySizing, "kinds" | "maxAnswer">): MysteryPlan {
  const out = structuredClone(plan);
  const seen = new Set<string>();
  for (const ch of out.chapters)
    ch.clues = ch.clues.filter((cl) => {
      const letters = lettersOf(cl.answer);
      const ok = z.kinds.includes(cl.kind) && !answerProblem(cl.kind, cl.answer, z.maxAnswer) && !seen.has(letters);
      if (ok) seen.add(letters);
      return ok;
    });
  return out;
}

/** The plan in plain words, for the chapter writer and the publisher's brief (it names the culprit). */
export function caseFile(plan: MysteryPlan): string {
  const people = plan.suspects.map((s) => `- ${s.name}, ${s.role}. Motive: ${s.motive} Alibi: ${s.alibi}${s.secret?.trim() ? ` Secret: ${s.secret}` : ""}`).join("\n");
  const chain = plan.chapters
    .map((ch, c) => `${c + 1}. ${ch.title}: ${ch.summary}${ch.clues.map((cl) => `\n   Clue (${cl.kind}) "${cl.answer}", from ${cl.source}: ${cl.reveals}${cl.suspect ? ` [${cl.effect} ${cl.suspect}]` : ""}`).join("")}`)
    .join("\n");
  const timeline = plan.timeline.map((e) => `- ${e.time} ${e.who}, ${e.where}: ${e.doing}`).join("\n");
  return [
    `${plan.caseTitle}. ${plan.setting}`,
    plan.premise,
    `Victim: ${plan.victim.name}, ${plan.victim.description}`,
    `Sleuth: ${plan.sleuth.name}, ${plan.sleuth.description}`,
    `Suspects:\n${people}`,
    `Culprit: ${plan.culprit}. Motive: ${plan.motive} Method: ${plan.method}`,
    `Crime scene: ${plan.crimeScene}, at ${plan.timeOfDeath}. True timeline:\n${timeline}`,
    `The wrong theory mid-book: ${plan.falseTheory.suspect}. ${plan.falseTheory.why}`,
    `Chapters and clues:\n${chain}`,
    `Final deduction: the reader spells ${plan.finalProof.answer} from letters of the clues. ${plan.finalProof.reveals}`,
    `Solution: ${plan.solution}`,
  ].join("\n\n");
}

export type MysteryAsk = <T extends "mystery-plan" | "mystery-chapter" | "mystery-test">(task: T, input: TaskInput<T>, outputs: string[]) => Promise<{ output: TaskOutput<T>; runId?: string }>;

export interface PlannedMystery {
  plan: MysteryPlan;
  runId?: string;
  /** What the fair-play check still found, for the run notes. */
  problems: string[];
  notes: string[];
}

/**
 * Ask for a plan, check it, and when it breaks the rules ask once more with
 * the problems spelled out. The better of the two is kept; if neither can
 * be built (no culprit among the suspects, too few chapters or clues), a
 * built-in case is used instead and the run says so. A plan that passes
 * then goes to a test reader who sees only the clues, checkpoint by
 * checkpoint; if the killer is obvious too early or the clues never lead
 * to them, the plan is sent back once more with what the reader concluded.
 */
export async function planMystery(ask: MysteryAsk, z: MysterySizing, i: MysteryInput): Promise<PlannedMystery> {
  const input: TaskInput<"mystery-plan"> = { topic: i.topic, audience: i.audience, title: i.title, angle: i.angle, notes: i.notes, chapters: z.chapters, cluesPerChapter: z.cluesPerChapter, kinds: z.kinds, difficulty: z.difficulty, maxAnswer: z.maxAnswer };
  const outputs = ["interior.plan", "interior.case"];
  const first = await ask("mystery-plan", input, outputs);
  let best = { ...checkMysteryPlan(first.output, z), runId: first.runId };
  const notes: string[] = [];
  if (best.problems.length) {
    const second = await ask("mystery-plan", { ...input, problems: best.problems.slice(0, 12) }, outputs).catch(() => null);
    if (second) {
      const again = { ...checkMysteryPlan(second.output, z), runId: second.runId };
      if ((best.fatal && !again.fatal) || (again.fatal === best.fatal && again.problems.length <= best.problems.length)) best = again;
    }
    notes.push(best.problems.length ? `Case plan: the fair-play check still found ${best.problems.length} problem(s) after a second plan: ${best.problems.slice(0, 3).join(" ")}` : "Case plan: the first plan failed the fair-play check; the second passed.");
  }
  if (best.fatal) {
    const fallback = offlineMystery(i.topic, i.topic.length);
    notes.push(`Case plan: the model's plan couldn't be built (${best.problems[0] ?? "unusable"}), so the built-in case "${fallback.plan.caseTitle}" was used.`);
    return { plan: structuredClone(fallback.plan), problems: [], notes };
  }
  // The test reader: one more plan when the reader solves it too soon or can't solve it at all.
  const tested = await readTest(ask, best.plan);
  if (tested.length) {
    const third = await ask("mystery-plan", { ...input, problems: [...tested, ...best.problems].slice(0, 12) }, outputs).catch(() => null);
    const again = third ? { ...checkMysteryPlan(third.output, z), runId: third.runId } : null;
    const againTest = again && !again.fatal && again.problems.length <= best.problems.length ? await readTest(ask, again.plan) : null;
    if (again && againTest && againTest.length < tested.length) {
      best = again;
      notes.push(againTest.length ? `Case plan: the test reader still found: ${againTest.join(" ")}` : "Case plan: a test reader solved the first plan too soon or not at all; the revised plan passed the test.");
      return { plan: usableClues(best.plan, z), runId: best.runId, problems: [...best.problems, ...againTest], notes };
    }
    notes.push(`Case plan: the test reader found: ${tested.join(" ")}`);
    return { plan: usableClues(best.plan, z), runId: best.runId, problems: [...best.problems, ...tested], notes };
  }
  return { plan: usableClues(best.plan, z), runId: best.runId, problems: best.problems, notes };
}

/** Ask a test reader to solve the case from the clues alone; returns what went wrong (none when the call fails or answers nothing, as offline). */
async function readTest(ask: MysteryAsk, plan: MysteryPlan): Promise<string[]> {
  const input: TaskInput<"mystery-test"> = {
    premise: plan.premise,
    victim: `${plan.victim.name}, ${plan.victim.description}`,
    suspects: plan.suspects.map((s) => ({ name: s.name, role: s.role, motive: s.motive, alibi: s.alibi })),
    checkpoints: testCheckpoints(plan),
  };
  const r = await ask("mystery-test", input, ["interior.case-test"]).catch(() => null);
  return r ? judgeTest(r.output.verdicts, plan.culprit) : [];
}

/* --------------------------------- chapters -------------------------------- */

export interface ChapterPuzzle {
  title: string;
  words: string[];
  entries: CrosswordEntry[];
}

export interface WrittenChapter {
  story: string;
  puzzles: ChapterPuzzle[];
  runId?: string;
}

/** Words and answers per puzzle: fewer than a plain puzzle book, so the clue box fits on the page. */
function puzzleNeeds(kind: MysteryClueKind, z: MysterySizing): { words: number; entries: number; maxLength: number } {
  const cfg = puzzleConfig(kind, 1, z.difficulty, z.sizing);
  const need = puzzleContent(cfg, "", z.difficulty);
  if (need?.task === "word-lists") return { words: Math.min(kind === "word-search" ? 12 : 10, need.wordsPerPuzzle), entries: 0, maxLength: kind === "word-search" ? need.maxLength : 9 };
  if (need?.task === "crossword-clues") return { words: 0, entries: Math.min(10, need.entriesPerPuzzle), maxLength: need.maxLength };
  return { words: 0, entries: 0, maxLength: 9 };
}

export function chapterRequest(plan: MysteryPlan, c: number, z: MysterySizing, audience: string, file = caseFile(plan)): TaskInput<"mystery-chapter"> {
  const ch = plan.chapters[c];
  const ws = puzzleNeeds("word-search", z);
  const cw = puzzleNeeds("crossword", z);
  return {
    caseFile: file,
    audience,
    chapter: c + 1,
    totalChapters: plan.chapters.length,
    title: ch.title,
    summary: ch.summary,
    earlier: plan.chapters.slice(0, c).map((x, k) => `${k + 1}. ${x.title}: ${x.summary}`),
    clues: ch.clues.map((cl) => ({ kind: cl.kind, answer: cl.answer, reveals: cl.reveals, theme: cl.theme, source: cl.source })),
    previousClues: c > 0 ? plan.chapters[c - 1].clues.map((cl) => cl.answer) : [],
    words: z.wordsPerChapter,
    wordsPerPuzzle: ws.words,
    entriesPerPuzzle: cw.entries,
    maxLength: Math.min(ws.maxLength, cw.maxLength),
    difficulty: z.difficulty,
    reveal: false,
  };
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
const titleCase = (s: string) => s.replace(/\b\w/g, (ch) => ch.toUpperCase()).slice(0, 24);
const BANK_WORDS = [...new Set(Object.values(THEME_BANK).flat().map((w) => normalizeWord(w)))];

/** Add bank words holding the letters a secret still lacks, so the shaded squares can spell it. */
export function ensureSecret(words: string[], secret: string): string[] {
  if (secretOrder(words, secret)) return words;
  const out = [...words];
  for (const ch of normalizeWord(secret)) {
    if (secretOrder(out, secret)) break;
    const extra = BANK_WORDS.find((w) => w.length >= 4 && w.length <= 8 && w.includes(ch) && !out.includes(w));
    if (extra) out.push(extra);
  }
  return out;
}

/**
 * Tidy one written chapter against its clues: word lists cleaned and long
 * enough, scrambles able to spell their secret, crosswords holding their
 * key answer. Returns what is still wrong, for one rewrite.
 */
export function checkChapter(out: MysteryChapterOutput, clues: MysteryClue[], z: MysterySizing, words: number, previous: MysteryClue[] = []): { chapter: WrittenChapter; problems: string[] } {
  const problems: string[] = [];
  const story = out.story.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (wordCount(story) < Math.min(120, words * 0.4)) problems.push(`The story is too short (${wordCount(story)} words; write about ${words}).`);
  // Readers who skip a puzzle still learn its answer here; one-word clues can be checked for.
  for (const cl of previous)
    if ((cl.kind === "crossword" || cl.kind === "word-scramble") && !new RegExp(`\\b${cl.answer}\\b`, "i").test(story))
      problems.push(`Let the sleuth learn the last chapter's clue "${cl.answer}" plainly, using the word itself, for readers who skipped the puzzle.`);
  const puzzles: ChapterPuzzle[] = clues.map((cl, k) => {
    const p = out.puzzles[k] ?? { title: "", words: [], entries: [] };
    const title = p.title.trim().slice(0, 24) || titleCase(cl.theme.replace(/^the\s+/i, "")) || "Clue";
    const n = puzzleNeeds(cl.kind, z);
    if (cl.kind === "word-search" || cl.kind === "word-scramble") {
      // Words of the hidden message would read twice, so they stay out of a word search.
      const message = new Set(cl.answer.split(/\s+/).map((w) => normalizeWord(w)));
      const kept = cleanWordList(p.words, { maxLength: n.maxLength, scramble: cl.kind === "word-scramble" }).kept.filter((w) => cl.kind !== "word-search" || !message.has(w));
      if (kept.length < 6) problems.push(`Puzzle ${k + 1} needs ${n.words} usable words (has ${kept.length}).`);
      return { title, words: kept.slice(0, Math.max(n.words, cl.kind === "word-scramble" ? lettersOf(cl.answer).length : 0)), entries: [] };
    }
    if (cl.kind === "crossword") {
      const kept = cleanCrossword(p.entries, n.maxLength).kept;
      if (!kept.some((e) => e.answer === lettersOf(cl.answer))) problems.push(`Crossword ${k + 1} must include the answer ${cl.answer} with a clue.`);
      if (kept.length < 6) problems.push(`Crossword ${k + 1} needs ${n.entries} usable entries (has ${kept.length}).`);
      return { title, words: [], entries: kept.slice(0, n.entries + 2) };
    }
    return { title, words: [], entries: [] };
  });
  return { chapter: { story, puzzles }, problems };
}

/** Last-resort fixes so a chapter always builds: bank words, a plain clue for a missing key answer. */
function repairChapter(ch: WrittenChapter, clues: MysteryClue[], z: MysterySizing): WrittenChapter {
  const puzzles = ch.puzzles.map((p, k) => {
    const cl = clues[k];
    const n = puzzleNeeds(cl.kind, z);
    if (cl.kind === "word-search" || cl.kind === "word-scramble") {
      const theme = Object.keys(THEME_BANK).find((t) => cl.theme.toLowerCase().includes(t.toLowerCase().replace(/s$/, ""))) ?? Object.keys(THEME_BANK)[k % Object.keys(THEME_BANK).length];
      const extra = cleanWordList(THEME_BANK[theme], { maxLength: n.maxLength, scramble: cl.kind === "word-scramble" }).kept.filter((w) => !p.words.includes(w) && !cl.answer.split(/\s+/).includes(w));
      let words = p.words.length >= 6 ? p.words : [...p.words, ...extra].slice(0, n.words);
      if (cl.kind === "word-scramble") words = ensureSecret(words, cl.answer);
      return { ...p, words };
    }
    if (cl.kind === "crossword" && !p.entries.some((e) => e.answer === lettersOf(cl.answer)))
      return { ...p, entries: [{ answer: lettersOf(cl.answer), clue: `The case clue in this chapter (${lettersOf(cl.answer).length} letters)` }, ...p.entries] };
    return p;
  });
  return { ...ch, puzzles };
}

/**
 * Write every chapter to the plan (a few at a time), check each one and ask
 * once more for any that come back short or broken, then write the
 * solution. A chapter whose writing fails outright is built from its plan
 * summary so the book still holds together; the run notes say so.
 */
export async function writeMystery(ask: MysteryAsk, plan: MysteryPlan, z: MysterySizing, audience: string, pool: <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>) => Promise<R[]>): Promise<{ chapters: WrittenChapter[]; reveal: WrittenChapter; notes: string[] }> {
  const file = caseFile(plan);
  const notes: string[] = [];
  const chapters = await pool(plan.chapters, async (ch, c) => {
    const req = chapterRequest(plan, c, z, audience, file);
    const clues = ch.clues;
    const previous = c > 0 ? plan.chapters[c - 1].clues : [];
    let r: { output: MysteryChapterOutput; runId?: string } | null = null;
    try {
      r = await ask("mystery-chapter", req, [`interior.chapter:${c + 1}`]);
    } catch (e) {
      if ((e as { status?: number })?.status && [401, 403, 429, 499, 503].includes((e as { status: number }).status)) throw e;
    }
    let checked = r ? checkChapter(r.output, clues, z, req.words, previous) : { chapter: { story: ch.summary, puzzles: [] }, problems: ["no answer"] };
    let runId = r?.runId;
    if (checked.problems.length) {
      const again = await ask("mystery-chapter", { ...req, feedback: `Fix these: ${checked.problems.join(" ")}`.slice(0, 500) }, [`interior.chapter:${c + 1}`]).catch(() => null);
      const second = again ? checkChapter(again.output, clues, z, req.words, previous) : null;
      if (second && second.problems.length <= checked.problems.length) {
        checked = second;
        runId = again!.runId ?? runId;
      }
      if (checked.problems.length) notes.push(`Chapter ${c + 1}: ${checked.problems.join(" ")} Filled in from the built-in banks where needed.`);
    }
    const chapter = repairChapter(checked.chapter.puzzles.length === clues.length ? checked.chapter : { ...checked.chapter, puzzles: clues.map((cl) => ({ title: titleCase(cl.theme), words: [], entries: [] })) }, clues, z);
    if (!chapter.story.trim()) chapter.story = ch.summary;
    return { ...chapter, runId };
  });
  const revealReq = { ...chapterRequest(plan, plan.chapters.length - 1, z, audience, file), chapter: plan.chapters.length + 1, title: "The Solution", summary: plan.solution, clues: [], reveal: true, words: Math.max(z.wordsPerChapter, 350) };
  const rv = await ask("mystery-chapter", revealReq, ["interior.solution"]).catch(() => null);
  let reveal: WrittenChapter = { story: rv?.output.story.trim() ?? "", puzzles: [], runId: rv?.runId };
  if (wordCount(reveal.story) < 80) {
    notes.push("The solution chapter came back short, so the plan's own solution is printed instead.");
    reveal = { story: `${plan.solution}\n\n${plan.method}`, puzzles: [] };
  }
  return { chapters, reveal, notes };
}

/* --------------------------------- layout ---------------------------------- */

const HOW: Record<MysteryClueKind, string> = {
  "word-search": "Word search: find and cross out every word, then read the letters left over, row by row from the top left. The clue box says which of them spell the clue.",
  crossword: "Crossword: the answer to the starred (*) clue, in the shaded squares, is the clue.",
  "word-scramble": "Word scramble: write each answer in the squares. The shaded letters, read from the top answer down, spell the clue.",
  cryptogram: "Cryptogram: crack the code. The message itself is the clue.",
};

const NAME: Record<MysteryClueKind, [string, string]> = {
  "word-search": ["word search", "word searches"],
  crossword: ["crossword", "crosswords"],
  "word-scramble": ["word scramble", "word scrambles"],
  cryptogram: ["cryptogram", "cryptograms"],
};

/** Make sure a puzzle hides its clue: drop words until the message fits a word search, or answers until a crossword holds its key. */
function fitClue(cfg: GeneratorConfig, clue: MysteryClue): GeneratorConfig {
  if (cfg.kind === "word-search") {
    const p = cfg.puzzles[0];
    let words = p.words;
    while (words.length > 6 && !generateWordSearch(words, cfg.size, cfg.difficulty, cfg.seed, LETTERS, clue.answer).message) words = words.slice(0, -1);
    return { ...cfg, puzzles: [{ ...p, words }] };
  }
  if (cfg.kind === "crossword") {
    const p = cfg.puzzles[0];
    const key = normalizeAnswer(clue.answer);
    let entries = p.entries;
    const placed = (e: CrosswordEntry[]) => generateCrossword(e, cfg.size, cfg.difficulty, cfg.seed, key).words.some((w) => w.answer === key);
    while (entries.length > 5 && !placed(entries)) {
      // Drop the longest other answer: long answers are the hardest to fit around.
      const longest = entries.filter((e) => normalizeAnswer(e.answer) !== key).sort((a, b) => b.answer.length - a.answer.length)[0];
      entries = entries.filter((e) => e !== longest);
    }
    return { ...cfg, puzzles: [{ ...p, entries }] };
  }
  return cfg;
}

const withPart = (cfg: GeneratorConfig, part: "puzzles" | "solutions"): GeneratorConfig => ({ ...cfg, part }) as GeneratorConfig;

/** "The gardener" reads "Thomas Briggs, the gardener" after a name. */
const lowerArticle = (role: string) => role.trim().replace(/^(The|A|An|His|Her|Their)\b/, (w) => w.toLowerCase());

export interface MysteryLayoutInput extends MysteryInput {
  subtitle: string;
  author: string;
  planRunId?: string;
}

export interface MysteryBook {
  sections: SectionInput[];
  /** What is inside, without spoilers, for the listing. */
  summary: string;
  clues: number;
}

/**
 * Lay out the whole mystery: title, how to solve, the suspects, case notes
 * and contents; each chapter's story followed by its clue puzzles (numbered
 * by clue, so puzzle 5 is clue 5); then the accusation page, the answer key
 * (every puzzle solved, with its clue), the sealed solution, notes pages to
 * the target and a closing page.
 */
export function assembleMystery(plan: MysteryPlan, chapters: WrittenChapter[], reveal: WrittenChapter, z: MysterySizing, i: MysteryLayoutInput): MysteryBook {
  const target = clampPageTarget(i.pageTarget);
  const runId = i.planRunId;
  const measure = (s: { title: string; kicker?: string; body: string }) => storyPagesNeeded(s, { spec: z.spec, pageCountHint: target, style: z.style });
  const used = [...new Set(plan.chapters.flatMap((c) => c.clues.map((cl) => cl.kind)))];

  const howTo = [
    `You are working this case alongside ${plan.sleuth.name}. ${plan.premise}`,
    `Read each chapter, then solve the puzzles that follow it. Every puzzle hides one clue:`,
    used.map((k) => `• ${HOW[k]}`).join("\n"),
    "Write each clue in your Case Notes and think about what it tells you. Some clues point at a suspect, some clear one, and not every suspicious detail is what it seems.",
    "After the last chapter, the Final Deduction combines letters from your clues to show where the proof is hidden. Then name the killer on The Accusation page and turn to the solution. Stuck on a puzzle? Every answer is in the Answer Key, and each chapter mentions the clue the puzzle before it hid.",
  ].join("\n\n");
  const cast = [
    `The victim: ${plan.victim.name}. ${plan.victim.description}`,
    `The detective: ${plan.sleuth.name}. ${plan.sleuth.description}`,
    ...plan.suspects.map((s) => `${s.name}, ${lowerArticle(s.role)}. ${s.alibi}`),
  ].join("\n\n");
  const clueCount = plan.chapters.reduce((n, c) => n + c.clues.length, 0);
  const front: SectionInput[] = [
    { label: "Title page", role: "front", config: { kind: "title-page", title: i.title, subtitle: i.subtitle, author: i.author } },
    { label: "How to solve the case", role: "front", config: { kind: "text-page", title: "How to Solve the Case", body: howTo, aiRunId: runId } },
    { label: "The suspects", role: "front", config: { kind: "text-page", title: plan.caseTitle, body: cast, aiRunId: runId } },
    { label: "Case notes", role: "front", config: { kind: "log", count: clueCount > 22 ? 2 : 1, title: "Case Notes", columns: ["Puzzle", "Clue", "What it tells you"], rows: Math.min(22, Math.max(10, clueCount)) } },
    { label: "Contents", role: "front", config: { kind: "table-of-contents", entries: [] } },
  ];

  // One seed per puzzle kind; the n-th puzzle of a kind uses seed + n in its chapter and in the answer key, so both draw the same grid.
  const seeds = new Map(MYSTERY_CLUE_KINDS.map((k) => [k, randomSeed()]));
  const byKind = new Map<MysteryClueKind, { config: GeneratorConfig; number: number }[]>();
  const body: { entry: string; items: SectionInput[] }[] = [];
  let clueNo = 0;
  plan.chapters.forEach((ch, c) => {
    const written = chapters[c] ?? { story: ch.summary, puzzles: [] };
    const first = clueNo + 1;
    const last = clueNo + ch.clues.length;
    const lead = ch.clues.length ? `\n\nTurn the page and solve ${ch.clues.length === 1 ? `puzzle ${first}` : `puzzles ${first} to ${last}`} to find the clue${ch.clues.length === 1 ? "" : "s"}.` : "";
    const story = { title: ch.title, kicker: `Chapter ${c + 1}`, body: `${written.story}${lead}` };
    const items: SectionInput[] = [{ label: `Chapter ${c + 1}: ${ch.title}`.slice(0, 60), role: "body", config: { kind: "story", ...story, pages: measure(story), aiRunId: written.runId } }];
    ch.clues.forEach((cl, k) => {
      clueNo++;
      const list = byKind.get(cl.kind) ?? [];
      const seed = seeds.get(cl.kind)! + list.length;
      const p = written.puzzles[k] ?? { title: titleCase(cl.theme), words: [], entries: [] };
      const base = puzzleConfig(cl.kind, 1, z.difficulty, z.sizing);
      let config: GeneratorConfig;
      if (base.kind === "word-search") config = { ...base, puzzles: [{ title: p.title, words: p.words, message: cl.answer }], seed, numbers: [clueNo], aiRunId: written.runId };
      else if (base.kind === "word-scramble") config = { ...base, puzzles: [{ title: p.title, words: ensureSecret(p.words, cl.answer), secret: cl.answer }], seed, numbers: [clueNo], aiRunId: written.runId };
      else if (base.kind === "crossword") config = { ...base, puzzles: [{ title: p.title, entries: p.entries, key: cl.answer }], seed, numbers: [clueNo], aiRunId: written.runId };
      else config = { kind: "cryptogram", phrases: [cl.answer], difficulty: z.difficulty, perPage: 1, solutions: true, seed, numbers: [clueNo], aiRunId: runId };
      config = fitClue(config, cl);
      list.push({ config, number: clueNo });
      byKind.set(cl.kind, list);
      items.push({ label: `Puzzle ${clueNo}: ${p.title}`.slice(0, 60), role: "body", config: withPart(config, "puzzles") });
    });
    body.push({ entry: `${c + 1}. ${ch.title}`, items });
  });

  // The final deduction: one letter from earlier clues spells where the proof is (skipped if the clues can't spell it).
  const answers = plan.chapters.flatMap((ch) => ch.clues.map((cl) => cl.answer));
  const picks = deductionPicks(answers, plan.finalProof.answer);
  const deduction: GeneratorConfig | null = picks
    ? {
        kind: "deduction",
        title: "Final Deduction",
        body: `${plan.sleuth.name} has every clue now. One question is left: where is the proof that will stand up in court? Take one letter from each clue below, counting letters only (skip spaces and punctuation), using the clues in your Case Notes.`,
        picks,
        answer: plan.finalProof.answer,
        aiRunId: runId,
      }
    : null;
  if (deduction) body.push({ entry: "Final Deduction", items: [{ label: "Final deduction", role: "body", config: deduction }] });

  // The answer key groups each kind's puzzles in one section, in the order they appear.
  const keys: SectionInput[] = [];
  for (const kind of used) {
    const list = byKind.get(kind) ?? [];
    if (!list.length) continue;
    const first = list[0].config;
    const numbers = list.map((x) => x.number);
    let config: GeneratorConfig;
    if (first.kind === "cryptogram") config = { ...first, phrases: list.flatMap((x) => (x.config.kind === "cryptogram" ? x.config.phrases : [])), seed: seeds.get(kind)!, numbers };
    else if (first.kind === "word-search") config = { ...first, puzzles: list.flatMap((x) => (x.config.kind === "word-search" ? x.config.puzzles : [])), seed: seeds.get(kind)!, numbers };
    else if (first.kind === "word-scramble") config = { ...first, puzzles: list.flatMap((x) => (x.config.kind === "word-scramble" ? x.config.puzzles : [])), seed: seeds.get(kind)!, numbers };
    else if (first.kind === "crossword") config = { ...first, puzzles: list.flatMap((x) => (x.config.kind === "crossword" ? x.config.puzzles : [])), seed: seeds.get(kind)!, numbers };
    else continue;
    keys.push({ label: `Answers: ${NAME[kind][1]}`, role: "back", config: withPart(config, "solutions") });
  }
  if (deduction && deduction.kind === "deduction") keys.push({ label: "Answers: final deduction", role: "back", config: { ...deduction, solved: true } });

  const solution = { title: "The Solution", kicker: plan.caseTitle, body: reveal.story };
  const back: SectionInput[] = [
    { label: "The accusation", role: "back", config: { kind: "journal-prompts", prompts: [`The Accusation: who killed ${plan.victim.name}? Name the culprit, explain how and why, and list the clues that prove it.`], spacingIn: z.largePrint ? 0.375 : 0.3125 } },
    { label: "Answer key", role: "back", config: { kind: "section-divider", title: "Answer Key", subtitle: "", detail: "Every puzzle solved, with the clue it hides" } },
    ...keys,
    { label: "Case closed", role: "back", config: { kind: "section-divider", title: "Case Closed", subtitle: "Make your accusation before you turn the page.", kicker: "The solution" } },
    { label: "The solution", role: "back", config: { kind: "story", ...solution, pages: measure(solution), aiRunId: reveal.runId } },
  ];
  const closing: SectionInput[] = [{ label: "Thank you", role: "back", config: { kind: "text-page", title: "Thank You", body: `Thank you for working the case of ${plan.caseTitle}. We hope the clues kept you guessing until the very last page, and that you caught the killer before ${plan.sleuth.name} did.` } }];

  const count = (list: SectionInput[]) => list.reduce((t, s) => t + estimatePageCount("config" in s ? s.config : s), 0);
  const all: SectionInput[] = [];
  // Dividers open on a right-hand page, as in assembleBook.
  for (const s of [...front, ...body.flatMap((b) => b.items), ...back]) {
    if ("config" in s && s.config.kind === "section-divider" && count(all) % 2 === 1) s.config = { ...s.config, blankBefore: true };
    all.push(s);
  }
  let pad = Math.max(0, Math.max(target, MIN_PAGES) - count(all) - count(closing));
  if ((count(all) + count(closing) + pad) % 2) pad++;
  if (pad) all.push({ label: "Detective's notes", role: "back", config: { kind: "lined", count: pad, spacingIn: 0.3125, header: false } });
  all.push(...closing);

  // Contents: the suspects, the chapters, the accusation, the answer key and the solution.
  const entries: { title: string; page: number }[] = [];
  let pageNo = 1;
  for (const s of all) {
    const cfg = "config" in s ? s.config : s;
    const label = "config" in s ? s.label : "";
    const chapter = body.find((b) => b.items[0] === s);
    const title = chapter ? chapter.entry : ({ "The suspects": "The Suspects", "Case notes": "Case Notes", "The accusation": "The Accusation", "Answer key": "Answer Key", "Case closed": "The Solution" } as Record<string, string>)[label];
    if (title) entries.push({ title, page: pageNo + (cfg.kind === "section-divider" && cfg.blankBefore ? 1 : 0) });
    pageNo += estimatePageCount(cfg);
  }
  const toc = all.findIndex((s) => "config" in s && s.config.kind === "table-of-contents");
  all[toc] = { label: "Contents", role: "front", config: { kind: "table-of-contents", entries } };

  const kinds = used.map((k) => `${byKind.get(k)?.length ?? 0} ${NAME[k][(byKind.get(k)?.length ?? 0) === 1 ? 0 : 1]}`).join(", ");
  const summary = `${plan.chapters.length} story chapters; ${clueCount} clue puzzles (${kinds}), each hiding a clue; ${plan.suspects.length} suspects; case notes and accusation pages; full answer key and a sealed solution`;
  return { sections: all, summary, clues: clueCount };
}

/** All the built-in cases, for tests and the samples. */
export const BUILT_IN_CASES = OFFLINE_MYSTERIES;
