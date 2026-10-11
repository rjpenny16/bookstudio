import { recipeBlueprint } from "@/lib/agent/recipes";
import { genreOf } from "@/lib/cover/genres";
import { restyleOffline } from "@/lib/cover/restyle";
import { nearDuplicate } from "@/lib/quality/content";
import { AFFIRMATION_BANK, PROMPT_BANK, SAYING_BANK, THEME_BANK } from "./offlineBanks";
import type { TaskInput, TaskName, TaskOutput } from "./tasks";

/**
 * Deterministic, model-free fallbacks so every AI-assisted workflow still works
 * on a fresh self-hosted install. Output is clearly labelled "offline" in the UI.
 */

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
/** Title case that leaves short joining words lowercase ("Sudoku for Seniors"). */
const titleCase = (s: string) => s.replace(/\w\S*/g, (w, i: number) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));

const NOUNS: Record<string, { noun: string; present: RegExp }> = {
  puzzle: { noun: "Puzzle Book", present: /puzzle|sudoku|search|maze|crossword|cryptogram|scramble|word find|brain games|logic/i },
  activity: { noun: "Activity Book", present: /activit|workbook|puzzle|maze|colou?ring/i },
  journal: { noun: "Journal", present: /journal|diary|notebook/i },
  planner: { noun: "Planner", present: /planner|organi[sz]er|agenda|calendar/i },
  "log-book": { noun: "Log Book", present: /\blog\b|logbook|log book|tracker|record book/i },
};

/** A title from the topic, adding the format noun only when the topic doesn't already name it, and before any "for …" phrase. */
export function offlineTitle(topic: string, bookType: string): string {
  const t = titleCase(topic.trim() || "Daily");
  const n = NOUNS[bookType] ?? { noun: "Notebook", present: /notebook|journal|sketchbook/i };
  if (n.present.test(t)) return t;
  const m = t.match(/\s+(for|with)\s+/i);
  return m ? `${t.slice(0, m.index)} ${n.noun}${t.slice(m.index)}` : `${t} ${n.noun}`;
}

/** The reader in a few words: "Seniors who want easy-to-read puzzles" becomes "Seniors". */
export function audienceHead(audience: string): string {
  const head = audience.trim().split(/\s+(?:who|that|with|looking|wanting|interested|aged)\b/i)[0].replace(/[.,;:]+$/, "").trim();
  return titleCase(head || "Adults");
}

/** A subtitle that says what the book does and who it is for, without repeating the whole audience sentence. */
export function offlineSubtitle(bookType: string, topic: string, audience: string): string {
  const who = audienceHead(audience);
  const large = /large[- ]print|senior|low vision/i.test(`${topic} ${audience}`);
  switch (bookType) {
    case "puzzle":
      return large ? `Easy-to-Read Large Print Puzzles with Solutions for ${who}` : `Fun, Brain-Boosting Puzzles with Solutions for ${who}`;
    case "activity":
      return `Fun Activities and Puzzles for ${who}`;
    case "journal":
      return /gratitude|thankful|grateful/i.test(topic) ? `A Simple Daily Gratitude Practice for ${who}` : `Guided Prompts to Reflect and Grow, for ${who}`;
    case "planner":
      return `Plan, Prioritize and Stay on Track: A Planner for ${who}`;
    case "log-book":
      return `Record Dates, Details and Notes: A Log Book for ${who}`;
    default:
      return `A Notebook for ${who}`;
  }
}

/** Back-cover copy in the length the cover is designed for: a hook, what's inside, who it's for. */
function offlineBlurb(i: { title: string; bookType: string; audience: string; pageCount: number; trim: string }): string {
  const who = audienceHead(i.audience).toLowerCase();
  const hook: Record<string, string> = {
    puzzle: `Settle in with ${i.title}, a satisfying mix of puzzles that keeps your mind sharp one page at a time.`,
    activity: `${i.title} is packed with screen-free fun that keeps young minds busy and proud of every finished page.`,
    journal: `${i.title} gives you a few quiet minutes a day to slow down, notice what matters and write it down.`,
    planner: `${i.title} turns busy weeks into clear plans, with room for every task, goal and note.`,
    "log-book": `${i.title} keeps every record in one tidy place, ready whenever you are.`,
  };
  return [
    hook[i.bookType] ?? `${i.title} is a simple, well-made notebook for everyday use.`,
    ({
      puzzle: "The puzzles build gently from easy to hard, and every one has its solution at the back.",
      activity: "Every page is a new challenge, with answers at the back for a quick check.",
      journal: "Each page gives you a gentle prompt and room to write, with no pressure to fill it perfectly.",
      planner: "Each spread gives you space for priorities, appointments and notes, so nothing slips through.",
      "log-book": "Each page has clear columns to fill in, so entries stay neat and easy to look back on.",
    } as Record<string, string>)[i.bookType] ?? "",
    `Made for ${who}, with clear, uncluttered pages that are easy on the eyes.`,
    `${i.pageCount} pages in a ${i.trim} paperback that makes a thoughtful gift.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Up to `count` items of `pool`, starting at a topic-dependent offset, skipping anything in `avoid`. */
function pick(pool: string[], count: number, seed: string, avoid: string[] = []): string[] {
  const usable = pool.filter((p) => !avoid.some((a) => nearDuplicate(p, a)));
  if (!usable.length) return [];
  const start = hash(seed) % usable.length;
  return Array.from({ length: Math.min(count, usable.length) }, (_, k) => usable[(start + k) % usable.length]);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function offlineTask<T extends TaskName>(task: T, input: TaskInput<T>): TaskOutput<T> {
  switch (task) {
    case "brief": {
      const i = input as TaskInput<"brief">;
      const topic = titleCase(i.topic.trim() || "Daily");
      const genre = genreOf({ bookType: i.bookType, topic: i.topic, audience: i.audience });
      const title = offlineTitle(i.topic, i.bookType);
      const type = i.bookType;
      const generator =
        type === "puzzle" ? (/word/i.test(i.topic) ? "word-search" : /maze/i.test(i.topic) ? "maze" : "sudoku") :
        type === "planner" ? "daily-planner" :
        type === "log-book" ? "log" :
        type === "activity" ? "maze" :
        /gratitude|thank/i.test(i.topic) ? "gratitude" :
        type === "journal" ? "journal-prompts" :
        /dot|bullet/i.test(i.topic) ? "dot-grid" : "lined";
      const noun = type === "puzzle" ? "Puzzle Book" : type === "planner" ? "Planner" : type === "log-book" ? "Log Book" : type === "journal" ? "Journal" : type === "activity" ? "Activity Book" : "Notebook";
      const audience = i.audience.trim() || "adults";
      const out: TaskOutput<"brief"> = {
        angle: `A practical ${noun.toLowerCase()} about ${topic.toLowerCase()} for ${audience}.`,
        audience,
        titleIdeas: [title, `The ${title}`, `My ${title}`, `${topic}: A ${noun} for ${audienceHead(audience)}`, `Simply ${topic}`],
        subtitle: offlineSubtitle(type, i.topic, audience),
        keywordIdeas: [`${i.topic} ${noun}`.toLowerCase(), `${i.topic} gift for ${audience}`.toLowerCase(), `${noun} for ${audience}`.toLowerCase(), `${i.topic} book`.toLowerCase(), `${i.topic} workbook`.toLowerCase()],
        interiorPlan: `${generator.replace("-", " ")} pages with a title page.`,
        generator,
        pageTarget: type === "puzzle" ? 120 : 120,
        difficulty: "medium",
        coverDirection: "Clean, high-contrast title readable as a thumbnail.",
        coverTemplate: genre.templates[0] as TaskOutput<"brief">["coverTemplate"],
        // Any of the genre's three best palettes, so books in one niche don't all look alike.
        palette: genre.palettes[hash(i.topic) % Math.min(3, genre.palettes.length)] as TaskOutput<"brief">["palette"],
        risks: ["Offline mode: no market research was performed. Check competing titles and trademarks before publishing."],
      };
      return out as TaskOutput<T>;
    }
    case "blueprint": {
      const i = input as TaskInput<"blueprint">;
      return recipeBlueprint({ bookType: i.bookType, topic: i.topic, audience: i.audience, notes: i.notes }) as TaskOutput<T>;
    }
    case "phrases": {
      const i = input as TaskInput<"phrases">;
      const pool = (i.style === "affirmation" ? AFFIRMATION_BANK : SAYING_BANK).filter((p) => p.length <= i.maxLength);
      return { phrases: pick(pool, i.count, i.topic, i.avoid) } as TaskOutput<T>;
    }
    case "listing": {
      const i = input as TaskInput<"listing">;
      const title = i.workingTitle || offlineTitle(i.topic, i.bookType);
      const out: TaskOutput<"listing"> = {
        title,
        subtitle: offlineSubtitle(i.bookType, i.topic, i.audience),
        description: [
          `Made for ${i.audience || "everyday use"}, this ${i.bookType.replace("-", " ")} keeps everything in one place, ready whenever you are.`,
          `Inside you will find:\n${[...i.interiorSummary.split(/;\s*/).filter(Boolean), `${i.pageCount} pages in a ${i.trim} paperback`, "Clean, uncluttered layout that is easy on the eyes"].map((l) => `• ${l}`).join("\n")}`,
          i.angle || "A thoughtful gift for home, school or travel.",
        ].join("\n\n"),
        keywords: [...i.keywordIdeas, `${i.topic} gift`, `${i.topic} for ${i.audience}`, `${i.bookType} for ${i.audience}`].map((k) => k.toLowerCase().slice(0, 50)).filter((k, n, a) => k.trim() && a.indexOf(k) === n).slice(0, 7),
        categories: (i.categoryOptions ?? []).slice(0, 3),
        backCoverBlurb: offlineBlurb({ title, bookType: i.bookType, audience: i.audience, pageCount: i.pageCount, trim: i.trim }),
        suggestedPriceUsd: i.pageCount > 150 ? 9.99 : 7.99,
      };
      return out as TaskOutput<T>;
    }
    case "journal-prompts": {
      const i = input as TaskInput<"journal-prompts">;
      // Only distinct prompts: a shorter section beats a journal that repeats itself.
      return { prompts: pick(PROMPT_BANK, i.count, `${i.topic}|${i.sectionTitle ?? ""}`, i.avoid) } as TaskOutput<T>;
    }
    case "word-lists": {
      const i = input as TaskInput<"word-lists">;
      const names = Object.keys(THEME_BANK);
      const match = names.find((n) => i.topic.toLowerCase().includes(n.toLowerCase().replace(/s$/, "")));
      const start = match ? names.indexOf(match) : hash(i.topic) % names.length;
      const avoid = new Set((i.avoid ?? []).map((t) => t.trim().toLowerCase()));
      // Later rounds through the themes take a different window of each theme's words,
      // stepping by more than half a list so no two puzzles share most of their words.
      const step = Math.floor(i.wordsPerPuzzle / 2) + 1;
      const puzzles: { title: string; words: string[] }[] = [];
      for (let k = 0; puzzles.length < i.count && k < names.length * 6; k++) {
        const name = names[(start + k) % names.length];
        const round = Math.floor(k / names.length);
        const words = THEME_BANK[name].filter((w) => w.length <= i.maxLength);
        if (round >= Math.floor(words.length / step)) continue;
        const title = round ? `${name} ${round + 1}` : name;
        if (avoid.has(title.toLowerCase())) continue;
        const offset = round * step;
        puzzles.push({ title, words: Array.from({ length: Math.min(i.wordsPerPuzzle, words.length) }, (_, n) => words[(offset + n) % words.length]) });
      }
      return { puzzles } as TaskOutput<T>;
    }
    case "keywords": {
      const i = input as TaskInput<"keywords">;
      const t = i.topic.toLowerCase();
      return {
        clusters: [
          { intent: "Gift", keywords: [`${t} gift`, `${t} gift for women`, `${t} gift for men`, `${t} birthday gift`] },
          { intent: "Format", keywords: [`${t} notebook`, `${t} journal`, `${t} log book`, `${t} workbook`] },
          { intent: "Seeds", keywords: i.seeds },
        ],
        notes: "Offline heuristic expansion. Validate with your research data before using.",
      } as TaskOutput<T>;
    }
    case "listing-critique": {
      const i = input as TaskInput<"listing-critique">;
      const out: TaskOutput<"listing-critique"> = {
        score: Math.max(3, 10 - i.ruleFindings.length),
        summary: "Offline mode: only the rule-based checks ran. Connect a model for a written critique and a revised listing.",
        findings: [],
        revised: { title: i.title, subtitle: i.subtitle, description: i.description, keywords: i.keywords, categories: i.categories },
      };
      return out as TaskOutput<T>;
    }
    case "cover-art-prompt": {
      const i = input as TaskInput<"cover-art-prompt">;
      const t = i.topic.trim() || i.title;
      const kid = /kid|child|ages? \d/i.test(i.audience);
      const mood = i.bookType === "puzzle" || i.bookType === "activity" || kid ? "bright, cheerful colors" : "calm, warm, muted colors";
      const ideas = [
        { name: "Iconic object", prompt: `A single iconic object that captures ${t}, centered, large and simple, on a softly textured plain background. Flat vector illustration, ${mood}, bold clean shapes.` },
        { name: "Gentle scene", prompt: `A gentle scene about ${t} for ${i.audience || "adults"}, wide open sky above, details concentrated in the lower half. Gouache-style illustration, ${mood}.` },
        { name: "Pattern", prompt: `A tidy repeating pattern of small motifs related to ${t}, evenly spaced, with a calmer band of plain color across the upper third. Flat illustration, ${mood}.` },
        { name: "Still life", prompt: `A cozy still life arranged on a table that suggests ${t}, seen slightly from above, soft daylight. Painterly flat illustration, ${mood}.` },
        { name: "Landscape", prompt: `A simple stylized landscape that evokes ${t}, layered hills and a big quiet sky. Paper-cut illustration style, ${mood}.` },
      ];
      const start = hash(t) % ideas.length;
      const concepts = Array.from({ length: i.count }, (_, n) => ideas[(start + n) % ideas.length]);
      const layout = i.bookType === "puzzle" || i.bookType === "activity" ? "art-panel" : i.bookType === "journal" || i.bookType === "notebook" ? "art-framed" : "art-full-bleed";
      const palette = (["midnight", "sage", "blush", "ocean", "sunny", "forest", "charcoal", "cream"] as const)[hash(t) % 8];
      return { layout, palette, concepts } as TaskOutput<T>;
    }
    case "cover-art-pick":
      return { choice: 1, reason: "Offline mode can't look at images; picked by measured title contrast instead.", problems: [] } as TaskOutput<T>;
    case "cover-style": {
      const i = input as TaskInput<"cover-style">;
      return restyleOffline(i.feedback, i.currentTemplate, i.currentPalette, genreOf({ bookType: i.bookType, topic: i.topic, audience: i.audience }).palettes) as TaskOutput<T>;
    }
    case "visual-review":
      return { score: 0, summary: "Offline mode can't look at images; only the rule-based design checks ran.", thumbnailReadable: true, findings: [] } as TaskOutput<T>;
  }
  throw new Error(`Unknown task ${task}`);
}
