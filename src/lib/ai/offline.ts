import { recipeBlueprint } from "@/lib/agent/recipes";
import type { TaskInput, TaskName, TaskOutput } from "./tasks";

/**
 * Deterministic, model-free fallbacks so every AI-assisted workflow still works
 * on a fresh self-hosted install. Output is clearly labelled "offline" in the UI.
 */

const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const GENERIC_PROMPTS = [
  "What made you smile today, and why?",
  "Describe a moment this week when you felt completely yourself.",
  "What is one small win you want to celebrate?",
  "Write about a place where you feel calm. What do you notice there?",
  "What would you tell your younger self about today?",
  "Which habit would make tomorrow easier?",
  "Who helped you recently, and how could you thank them?",
  "What are you looking forward to this month?",
  "Describe a challenge you handled better than you expected.",
  "What does a perfect ordinary day look like for you?",
  "List three things you can see, hear and feel right now.",
  "What is something you want to learn, and what is the first step?",
  "Write about a memory that still makes you laugh.",
  "What drained your energy today, and what restored it?",
  "Which boundary do you want to protect this week?",
  "What would you do if you knew you could not fail?",
  "Describe someone you admire and the quality you want to borrow.",
  "What is a belief you have changed your mind about?",
  "How did you take care of your body today?",
  "What are you ready to let go of?",
  "Write a short letter to your future self one year from now.",
  "What is one thing you are proud of that nobody else saw?",
  "Which song, book or film fits your mood today? Why?",
  "What does success mean to you right now?",
  "Describe your ideal morning routine in detail.",
  "What conversation do you need to have, and how could you start it?",
  "What surprised you this week?",
  "Write about a time you were brave.",
  "What are three things you love about where you live?",
  "Which worry can you set down for today?",
];

// Traditional proverbs (public domain) for offline cryptograms.
const SAYINGS = [
  "Slow and steady wins the race.",
  "A journey of a thousand miles begins with a single step.",
  "Many hands make light work.",
  "Where there is a will there is a way.",
  "Practice makes perfect.",
  "Every cloud has a silver lining.",
  "Actions speak louder than words.",
  "The early bird catches the worm.",
  "Rome was not built in a day.",
  "Little by little the bird builds its nest.",
  "A smooth sea never made a skilled sailor.",
  "Patience is a virtue.",
  "Two heads are better than one.",
  "Laughter is the best medicine.",
  "Better late than never.",
  "Every day is a fresh start.",
  "Kindness costs nothing.",
  "Good things come to those who wait.",
  "Fortune favors the bold.",
  "Knowledge is power.",
  "Still waters run deep.",
  "Home is where the heart is.",
  "Hope for the best and prepare for the worst.",
  "The best things in life are worth waiting for.",
  "A friend in need is a friend indeed.",
  "No rain, no flowers.",
  "Tomorrow is another day.",
  "Great minds think alike.",
  "One step at a time.",
  "Small steps lead to big changes.",
];

const AFFIRMATIONS = [
  "I am allowed to take today one moment at a time.",
  "I notice the good things around me.",
  "I am growing a little every day.",
  "I give myself the same kindness I give others.",
  "I am grateful for the people who support me.",
  "I can do hard things.",
  "My best is enough today.",
  "I choose calm over hurry.",
  "I make room for rest and joy.",
  "I welcome new beginnings.",
  "I am proud of how far I have come.",
  "Small moments of peace add up.",
  "I trust myself to handle what comes.",
  "I celebrate small wins.",
  "I deserve good things.",
];

const THEMES: Record<string, string[]> = {
  Animals: ["lion", "tiger", "zebra", "giraffe", "monkey", "panda", "koala", "rabbit", "turtle", "eagle", "dolphin", "penguin", "otter", "camel", "beaver"],
  Fruits: ["apple", "banana", "cherry", "grape", "lemon", "mango", "orange", "peach", "pear", "plum", "kiwi", "melon", "papaya", "guava", "lime"],
  Garden: ["flower", "seed", "soil", "rose", "tulip", "daisy", "shovel", "hose", "fence", "weed", "sprout", "bloom", "leaf", "root", "basket"],
  Ocean: ["wave", "shell", "coral", "whale", "shark", "tide", "reef", "sand", "crab", "anchor", "island", "pearl", "kelp", "squid", "harbor"],
  Space: ["planet", "comet", "orbit", "rocket", "galaxy", "moon", "star", "nebula", "meteor", "saturn", "venus", "mars", "jupiter", "launch", "cosmos"],
  Kitchen: ["spoon", "whisk", "oven", "kettle", "ladle", "plate", "bowl", "knife", "grater", "pan", "teapot", "napkin", "apron", "blender", "toaster"],
  Weather: ["rain", "cloud", "storm", "thunder", "breeze", "snow", "frost", "sunny", "rainbow", "drizzle", "fog", "hail", "lightning", "humid", "chilly"],
  Sports: ["soccer", "tennis", "hockey", "rugby", "golf", "boxing", "rowing", "cycling", "skiing", "karate", "archery", "diving", "surfing", "bowling", "cricket"],
  Music: ["piano", "guitar", "violin", "drums", "flute", "melody", "rhythm", "chorus", "tempo", "harmony", "cello", "trumpet", "banjo", "concert", "lyrics"],
  Travel: ["passport", "ticket", "luggage", "airport", "hotel", "map", "compass", "journey", "cruise", "train", "beach", "museum", "camera", "suitcase", "voyage"],
  Farm: ["barn", "tractor", "cow", "sheep", "goat", "horse", "chicken", "hay", "corn", "pumpkin", "farmer", "silo", "piglet", "orchard", "meadow"],
  Holidays: ["candle", "gift", "parade", "feast", "lantern", "wreath", "ribbon", "costume", "fireworks", "banner", "cookie", "carol", "family", "picnic", "party"],
};

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
      const pool = (i.style === "affirmation" ? AFFIRMATIONS : SAYINGS).filter((p) => p.length <= i.maxLength);
      const start = hash(i.topic) % pool.length;
      return { phrases: Array.from({ length: Math.min(i.count, pool.length) }, (_, k) => pool[(start + k) % pool.length]) } as TaskOutput<T>;
    }
    case "listing": {
      const i = input as TaskInput<"listing">;
      const title = i.workingTitle || titleCase(`${i.topic} ${i.bookType}`);
      const out: TaskOutput<"listing"> = {
        title,
        subtitle: `${titleCase(i.bookType)} for ${i.audience || "adults"} | ${i.pageCount} pages, ${i.trim}`,
        description: `${title} is a ${i.bookType} made for ${i.audience || "everyday use"}.\n\nInside you will find:\n• ${i.interiorSummary}\n• ${i.pageCount} pages in a ${i.trim} paperback\n• Clean layout printed on quality paper\n\n${i.angle || "Perfect for home, school, travel or as a thoughtful gift."}`,
        keywords: [...i.keywordIdeas, `${i.topic} gift`, `${i.topic} for ${i.audience}`, `${i.bookType} for ${i.audience}`].map((k) => k.toLowerCase().slice(0, 50)).filter((k, n, a) => k.trim() && a.indexOf(k) === n).slice(0, 7),
        categories: [],
        backCoverBlurb: `${title}: ${i.angle || `a ${i.bookType} for ${i.audience}`}`.slice(0, 450),
        suggestedPriceUsd: i.pageCount > 150 ? 9.99 : 7.99,
      };
      return out as TaskOutput<T>;
    }
    case "journal-prompts": {
      const i = input as TaskInput<"journal-prompts">;
      const start = hash(i.topic) % GENERIC_PROMPTS.length;
      const prompts = Array.from({ length: i.count }, (_, k) => GENERIC_PROMPTS[(start + k) % GENERIC_PROMPTS.length]);
      return { prompts } as TaskOutput<T>;
    }
    case "word-lists": {
      const i = input as TaskInput<"word-lists">;
      const names = Object.keys(THEMES);
      const match = names.find((n) => i.topic.toLowerCase().includes(n.toLowerCase().replace(/s$/, "")));
      const start = match ? names.indexOf(match) : hash(i.topic) % names.length;
      const puzzles = Array.from({ length: i.count }, (_, k) => {
        const name = names[(start + k) % names.length];
        const round = Math.floor(k / names.length);
        return { title: round ? `${name} ${round + 1}` : name, words: THEMES[name].filter((w) => w.length <= i.maxLength).slice(0, i.wordsPerPuzzle) };
      });
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
  }
  throw new Error(`Unknown task ${task}`);
}
