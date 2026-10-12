import type { BlueprintOutput, SectionKind } from "@/lib/ai/tasks";

/**
 * Genre recipes: deterministic book plans used offline and whenever a model's
 * plan is unusable. They encode what sells well on KDP for each book type: a
 * how-to page, a difficulty ramp for puzzles, variety for journals.
 */

export interface RecipeInput {
  bookType: string;
  topic: string;
  audience: string;
  notes: string;
}

type Section = BlueprintOutput["sections"][number];
type Difficulty = Section["difficulty"];

const sec = (kind: SectionKind, title: string, sharePercent: number, difficulty: Difficulty = "medium", theme = "", subtitle = ""): Section => ({ kind, title, subtitle, theme, sharePercent, difficulty });

const isKids = (i: RecipeInput) => /\b(kid|kids|child|children|ages? \d|toddler|preschool|boys?|girls?)\b/i.test(`${i.audience} ${i.topic}`);
const isLargePrint = (i: RecipeInput) => /large print|senior|elderly|low vision|grandparent|retire/i.test(`${i.audience} ${i.topic} ${i.notes}`);

export const PUZZLE_RULES: Partial<Record<SectionKind, string>> = {
  sudoku: "Sudoku: fill every row, column and 3×3 box with the digits 1 to 9, each exactly once. Every puzzle has one solution.",
  "word-search": "Word search: find each listed word in the grid. Words run in straight lines and may share letters.",
  "number-search": "Number search: find each listed number in the grid, reading in a straight line.",
  maze: "Mazes: trace a path from START to FINISH without crossing a wall.",
  "word-scramble": "Word scramble: rearrange the letters to spell a word from the page's theme.",
  cryptogram: "Cryptograms: each letter stands for a different letter. Use the hints and common short words to crack the code.",
  crossword: "Crosswords: read each clue and write the answer in the squares that start at its number, across or down. Crossing answers share letters, so each one you solve helps with the others.",
};

function puzzleSections(i: RecipeInput): Section[] {
  const t = i.topic.toLowerCase();
  const kids = isKids(i);
  const theme = i.topic;
  if (/sudoku/.test(t)) {
    if (kids) return [sec("sudoku", "Warm-Up Puzzles", 50, "easy", theme), sec("sudoku", "Challenge Puzzles", 50, "medium", theme)];
    if (/easy|beginner/.test(t)) return [sec("sudoku", "Gentle Start", 40, "easy", theme), sec("sudoku", "Easy", 60, "easy", theme)];
    return [sec("sudoku", "Easy", 25, "easy", theme), sec("sudoku", "Medium", 35, "medium", theme), sec("sudoku", "Hard", 25, "hard", theme), sec("sudoku", "Expert", 15, "expert", theme)];
  }
  if (/word ?search|word ?find/.test(t))
    return kids
      ? [sec("word-search", "Easy Searches", 55, "easy", theme), sec("word-search", "Super Searchers", 45, "medium", theme)]
      : [sec("word-search", "Warm-Up", 30, "easy", theme), sec("word-search", "Steady", 40, "medium", theme), sec("word-search", "Tricky", 30, "hard", theme)];
  if (/maze/.test(t)) return [sec("maze", "Easy Mazes", 35, "easy", theme), sec("maze", "Medium Mazes", 35, "medium", theme), kids ? sec("maze", "Tricky Mazes", 30, "medium", theme) : sec("maze", "Hard Mazes", 30, "hard", theme)];
  if (/crossword/.test(t))
    return kids
      ? [sec("crossword", "Easy Crosswords", 60, "easy", theme), sec("crossword", "Clever Crosswords", 40, "medium", theme)]
      : [sec("crossword", "Easy Crosswords", 30, "easy", theme), sec("crossword", "Crosswords", 40, "medium", theme), sec("crossword", "Hard Crosswords", 30, "hard", theme)];
  if (/cryptogram|cipher|code/.test(t)) return [sec("cryptogram", "Starter Codes", 40, "easy", theme), sec("cryptogram", "Code Breaker", 35, "medium", theme), sec("cryptogram", "Master Codes", 25, "hard", theme)];
  if (/scramble|jumble|anagram/.test(t)) return [sec("word-scramble", "Easy Scrambles", 50, "easy", theme), sec("word-scramble", "Harder Scrambles", 50, "medium", theme)];
  if (/number/.test(t)) return [sec("number-search", "Easy", 35, "easy", theme), sec("number-search", "Medium", 35, "medium", theme), sec("number-search", "Hard", 30, "hard", theme)];
  // Mixed variety book.
  return kids
    ? [sec("word-search", "Word Searches", 35, "easy", theme), sec("maze", "Mazes", 30, "easy", theme), sec("word-scramble", "Word Scrambles", 20, "easy", theme), sec("sudoku", "Number Puzzles", 15, "easy", theme)]
    : [
        sec("word-search", "Word Searches", 25, "medium", theme),
        sec("sudoku", "Sudoku", 20, "medium", theme),
        sec("crossword", "Crosswords", 20, "medium", theme),
        sec("word-scramble", "Word Scrambles", 12, "medium", theme),
        sec("cryptogram", "Cryptograms", 12, "medium", theme),
        sec("maze", "Mazes", 11, "medium", theme),
      ];
}

/** "Bird watching log book" becomes "Bird Watching Log", not "Bird watching log book Log". */
function logLabel(topic: string): string {
  const base = topic.trim().replace(/\s*\b(log ?book|log|journal|record book|tracker)\s*$/i, "").trim() || "Record";
  return `${base.replace(/\b\w/g, (c) => c.toUpperCase())} Log`.slice(0, 40);
}

function lowContentSections(i: RecipeInput): Section[] {
  const t = `${i.topic} ${i.notes}`.toLowerCase();
  const theme = i.topic;
  switch (i.bookType) {
    case "planner":
      return [
        sec("monthly-calendar", "Monthly Overview", 10, "medium", theme),
        sec("weekly-spread", "Weekly Plans", 40, "medium", theme),
        sec("daily-planner", "Daily Pages", 40, "medium", theme),
        sec("habit-tracker", "Habit Trackers", 10, "medium", theme),
      ];
    case "log-book":
      return [sec("log", logLabel(i.topic), 100, "medium", theme)];
    case "journal":
      if (/gratitude|thank/.test(t)) return [sec("gratitude", "Daily Gratitude", 85, "medium", theme), sec("free-write", "Reflections", 15, "medium", theme)];
      return [
        sec("journal-prompts", "Looking Back", 30, "medium", `${theme}: memories and reflection`),
        sec("journal-prompts", "Right Now", 30, "medium", `${theme}: the present moment and gratitude`),
        sec("journal-prompts", "Looking Ahead", 30, "medium", `${theme}: hopes, plans and growth`),
        sec("free-write", "Free Pages", 10, "medium", theme),
      ];
    default:
      if (/dot|bullet/.test(t)) return [sec("dot-grid", "Dot Grid", 100, "medium", theme)];
      if (/graph|grid|math|engineer/.test(t)) return [sec("graph", "Graph Paper", 100, "medium", theme)];
      return [sec("free-write", "Notes", 100, "medium", theme)];
  }
}

function howToUse(i: RecipeInput, sections: Section[]): { title: string; body: string } {
  const kinds = [...new Set(sections.map((s) => s.kind))];
  const rules = kinds.map((k) => PUZZLE_RULES[k]).filter(Boolean) as string[];
  if (rules.length)
    return {
      title: "How to Play",
      body: [`Welcome! This book is made for ${i.audience || "puzzle lovers"}. The puzzles start gentle and get more challenging as you go, so begin at the front and work your way up.`, ...rules, "Stuck? Every answer is in the Answer Key at the back of the book."].join("\n\n"),
    };
  switch (i.bookType) {
    case "planner":
      return { title: "How to Use This Planner", body: "Start with the monthly overview to note birthdays, deadlines and big goals. Each week, choose your top priorities, then use the daily pages to plan your hours and capture to-dos.\n\nAt the end of each month, fill in the habit tracker and notice what is working. There is no wrong way to use these pages: make them yours." };
    case "log-book":
      return { title: "How to Use This Log", body: "Fill in one row for each entry. Keeping your records in one place makes it easy to spot patterns, look up past details and share accurate information when you need it.\n\nWrite clearly, date every entry, and keep the book somewhere handy." };
    case "journal":
      return { title: "How to Use This Journal", body: `This journal is a quiet place for ${i.audience || "you"} to pause and reflect. Take one page at a time, in any order you like. There are no right or wrong answers.\n\nTry writing at the same time each day, even for five minutes. Small, steady entries add up to something you will be glad to look back on.` };
    default:
      return { title: "", body: "" };
  }
}

/** A complete blueprint for the given book, without any model call. */
export function recipeBlueprint(i: RecipeInput): BlueprintOutput {
  const puzzleBook = i.bookType === "puzzle" || i.bookType === "activity";
  const sections = puzzleBook ? puzzleSections(i) : lowContentSections(i);
  return {
    sections,
    largePrint: isLargePrint(i),
    startDate: "",
    logColumns: i.bookType === "log-book" ? ["Date", "Details", "Notes"] : [],
    howToUse: howToUse(i, sections),
    closing: { title: "Thank You", body: `Thank you for choosing this book. We hope it brought you ${puzzleBook ? "many happy hours of puzzling" : "calm, focus and a little joy"}.` },
  };
}
