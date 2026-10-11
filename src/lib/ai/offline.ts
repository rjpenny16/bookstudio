import { recipeBlueprint } from "@/lib/agent/recipes";
import { nearDuplicate } from "@/lib/quality/content";
import { AFFIRMATION_BANK, PROMPT_BANK, SAYING_BANK, THEME_BANK } from "./offlineBanks";
import type { TaskInput, TaskName, TaskOutput } from "./tasks";

/**
 * Deterministic, model-free fallbacks so every AI-assisted workflow still works
 * on a fresh self-hosted install. Output is clearly labelled "offline" in the UI.
 */

const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

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
        titleIdeas: [`${topic} ${noun}`, `The ${topic} ${noun}`, `My ${topic} ${noun}`, `${topic}: A ${noun} for ${titleCase(audience)}`, `Simply ${topic}`],
        subtitle: `A ${noun.toLowerCase()} for ${audience}`,
        keywordIdeas: [`${i.topic} ${noun}`.toLowerCase(), `${i.topic} gift for ${audience}`.toLowerCase(), `${noun} for ${audience}`.toLowerCase(), `${i.topic} book`.toLowerCase(), `${i.topic} workbook`.toLowerCase()],
        interiorPlan: `${generator.replace("-", " ")} pages with a title page.`,
        generator,
        pageTarget: type === "puzzle" ? 120 : 120,
        difficulty: "medium",
        coverDirection: "Clean, high-contrast title readable as a thumbnail.",
        coverTemplate: type === "puzzle" || type === "activity" ? "puzzle" : type === "journal" ? "framed" : type === "planner" ? "band" : "minimal",
        palette: (["midnight", "sage", "blush", "ocean", "sunny", "forest", "charcoal", "cream"] as const)[hash(i.topic) % 8],
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
      const title = i.workingTitle || titleCase(`${i.topic} ${i.bookType}`);
      const out: TaskOutput<"listing"> = {
        title,
        subtitle: `${titleCase(i.bookType.replace("-", " "))} for ${i.audience || "adults"}`,
        description: [
          `Made for ${i.audience || "everyday use"}, this ${i.bookType.replace("-", " ")} keeps everything in one place, ready whenever you are.`,
          `Inside you will find:\n${[...i.interiorSummary.split(/;\s*/).filter(Boolean), `${i.pageCount} pages in a ${i.trim} paperback`, "Clean, uncluttered layout that is easy on the eyes"].map((l) => `• ${l}`).join("\n")}`,
          i.angle || "A thoughtful gift for home, school or travel.",
        ].join("\n\n"),
        keywords: [...i.keywordIdeas, `${i.topic} gift`, `${i.topic} for ${i.audience}`, `${i.bookType} for ${i.audience}`].map((k) => k.toLowerCase().slice(0, 50)).filter((k, n, a) => k.trim() && a.indexOf(k) === n).slice(0, 7),
        categories: (i.categoryOptions ?? []).slice(0, 3),
        backCoverBlurb: `${title}: ${i.angle || `a ${i.bookType} for ${i.audience}`}`.slice(0, 450),
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
    case "visual-review":
      return { score: 0, summary: "Offline mode can't look at images; only the rule-based design checks ran.", thumbnailReadable: true, findings: [] } as TaskOutput<T>;
  }
  throw new Error(`Unknown task ${task}`);
}
