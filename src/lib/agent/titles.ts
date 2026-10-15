import type { TaskInput, TitleIdea, TitleIdeasOutput } from "@/lib/ai/tasks";
import { normalizeWord } from "@/lib/generators/wordsearch";
import { findProhibited } from "@/lib/metadata/validate";
import type { MysteryPlan } from "./mystery";

/**
 * Naming a book once its content exists. The brief's titles are written
 * from the topic alone; these come from what is actually inside (a
 * mystery's places, objects and motifs, a puzzle book's sections), are
 * checked for spoilers and listing rules, and the best one names the book.
 * The rest stay on the project as one-click alternatives.
 */

export const TITLE_MAX = 60;
const SUBTITLE_MAX = 120;

/** Name words too common to count as a spoiler on their own ("Dr.", "Lady"). */
const TITLES = new Set(["MR", "MRS", "MS", "MISS", "DR", "SIR", "LADY", "LORD", "CAPTAIN", "INSPECTOR", "DOCTOR", "THE"]);

/** Words a mystery's title must never contain: the culprit's names and the final proof. */
export function mysteryAvoid(plan: MysteryPlan): string[] {
  const names = plan.culprit.split(/\s+/).map((w) => w.replace(/[^A-Za-z'-]/g, "")).filter((w) => w.length >= 3 && !TITLES.has(normalizeWord(w)));
  return [...new Set([...names, plan.finalProof.answer].filter(Boolean))];
}

/** What a mystery holds, for the namer: everything but who did it. */
export function mysteryContents(plan: MysteryPlan): string {
  const b = plan.bible;
  return [
    `Case: ${plan.caseTitle}. ${plan.setting}`,
    plan.premise,
    `Victim: ${plan.victim.name}, ${plan.victim.description}`,
    `Detective: ${plan.sleuth.name}, ${plan.sleuth.description}`,
    `Suspects: ${plan.suspects.map((s) => `${s.name} (${s.role})`).join(", ")}`,
    b?.locations?.length ? `Places: ${b.locations.map((l) => l.name).join(", ")}` : "",
    b?.motifs?.length ? `Motifs: ${b.motifs.join("; ")}` : "",
    `Chapters: ${plan.chapters.map((c) => c.title).join("; ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** What any other book holds: its sections, with their themes where they have one. */
export function sectionContents(summary: string, sections: { label: string; theme?: string }[]): string {
  const parts = sections.filter((s) => s.theme?.trim()).map((s) => `${s.label}: ${s.theme}`);
  return [summary, parts.length ? `Section themes: ${parts.join("; ")}` : ""].filter(Boolean).join("\n");
}

export function titleRequest(i: Omit<TaskInput<"title-ideas">, "feedback">, feedback = ""): TaskInput<"title-ideas"> {
  return { ...i, contents: i.contents.slice(0, 4000), ...(feedback.trim() ? { feedback: feedback.trim().slice(0, 500) } : {}) };
}

const hasWord = (text: string, word: string) => {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`, "i").test(text);
};

export interface CheckedTitles {
  /** The ideas that pass, best first. */
  ideas: TitleIdea[];
  /** Why ideas were dropped, for the run notes. */
  dropped: string[];
}

/**
 * Keep the ideas that can go on the cover: a title under 60 characters, no
 * prohibited listing terms, none of the `avoid` words (spoilers), no
 * repeats. The pick goes first; when it was dropped, the first survivor
 * takes its place. The hero words are kept only when they are in the title.
 */
export function checkTitleIdeas(out: TitleIdeasOutput, avoid: string[]): CheckedTitles {
  const dropped: string[] = [];
  const seen = new Set<string>();
  const kept: { idea: TitleIdea; n: number }[] = [];
  out.ideas.forEach((raw, n) => {
    const title = raw.title.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
    const subtitle = raw.subtitle.replace(/\s+/g, " ").trim().slice(0, SUBTITLE_MAX);
    const both = `${title} ${subtitle}`;
    const key = title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const problem = !title
      ? "empty"
      : title.length > TITLE_MAX
        ? `over ${TITLE_MAX} characters`
        : findProhibited(both).length
          ? `uses "${findProhibited(both)[0]}"`
          : avoid.find((w) => hasWord(both, w))
            ? "gives the ending away"
            : seen.has(key)
              ? "a repeat"
              : null;
    if (problem) {
      if (title) dropped.push(`"${title}" (${problem})`);
      return;
    }
    seen.add(key);
    const hero = raw.hero.trim() && title.toLowerCase().includes(raw.hero.trim().toLowerCase()) ? raw.hero.trim() : "";
    kept.push({ idea: { title, subtitle, hero, why: raw.why.trim() }, n: n + 1 });
  });
  const pick = kept.findIndex((k) => k.n === out.pick);
  const ordered = pick > 0 ? [kept[pick], ...kept.filter((_, k) => k !== pick)] : kept;
  return { ideas: ordered.map((k) => k.idea), dropped };
}
