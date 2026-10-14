import type { BookType } from "@/lib/schema/project";

/**
 * The one-screen start asks only for a niche and an audience. Book type and
 * trim size are inferred here from the words used; page count and cover
 * style are left to the brief unless the Advanced section overrides them.
 * Everything inferred is shown with its reason so it can be corrected.
 */

export interface InferredSetup {
  bookType: BookType;
  trimId: string;
  /** Why each value was chosen, in plain words. */
  reasons: { bookType: string; trimId: string };
}

/** Book types autopilot can build (coloring needs your own art; "other" has no plan). */
export const AUTOPILOT_BOOK_TYPES: BookType[] = ["notebook", "journal", "planner", "log-book", "puzzle", "activity", "mystery"];

const MYSTERY = /\b(murder|mystery|mysteries|whodunn?it|detective|sleuth|crime scene|case file|cold case)\b/i;
const PUZZLE = /\b(sudoku|word ?search(es)?|word ?find|maze|mazes|cryptograms?|cipher|puzzles?|number ?search|word ?scrambles?|jumble|brain games?|logic)\b/i;
const ACTIVITY = /\b(activity|activities|coloring|colouring|dot[- ]to[- ]dot|tracing)\b/i;
const PLANNER = /\b(planner|agenda|organi[sz]er|calendar|schedule|habit tracker|weekly|monthly|daily plan|lesson plan)\b/i;
const LOG = /\b(log ?book|log|logs|record book|tracker|mileage|password|expense|inventory|maintenance|visitor|guest book)\b/i;
const NOTEBOOK = /\b(notebook|composition|sketch ?book|notepad|graph paper|dot grid|lined paper|blank book)\b/i;
const KIDS = /\b(kids?|child|children|toddlers?|preschool|ages? \d|boys?|girls?|teens?)\b/i;
const LARGE = /\b(large print|seniors?|elderly|low vision|grandparents?|retirees?)\b/i;

export function inferSetup(topic: string, audience: string): InferredSetup {
  const text = `${topic} ${audience}`;
  const kids = KIDS.test(text);
  const large = LARGE.test(text);
  let bookType: BookType = "journal";
  let why = "default for writing books";
  if (MYSTERY.test(topic)) {
    // Checked before puzzles: "murder mystery puzzle book" is a story with puzzles in it.
    bookType = "mystery";
    why = `"${topic.match(MYSTERY)![0]}" suggests a murder mystery`;
  } else if (PUZZLE.test(topic)) {
    bookType = kids && ACTIVITY.test(topic) ? "activity" : "puzzle";
    why = `"${topic.match(PUZZLE)![0]}" is a puzzle`;
  } else if (ACTIVITY.test(topic)) {
    bookType = "activity";
    why = `"${topic.match(ACTIVITY)![0]}" suggests an activity book`;
  } else if (PLANNER.test(topic)) {
    bookType = "planner";
    why = `"${topic.match(PLANNER)![0]}" suggests a planner`;
  } else if (LOG.test(topic)) {
    bookType = "log-book";
    why = `"${topic.match(LOG)![0]}" suggests a log book`;
  } else if (NOTEBOOK.test(topic)) {
    bookType = "notebook";
    why = `"${topic.match(NOTEBOOK)![0]}" suggests a notebook`;
  } else if (/\b(journal|diary|gratitude|prompts?|reflection|memoir)\b/i.test(topic)) {
    why = `"${topic.match(/\b(journal|diary|gratitude|prompts?|reflection|memoir)\b/i)![0]}" suggests a journal`;
  }

  let trimId = "6x9";
  let trimWhy = "the most common trade size for this kind of book";
  if (large) {
    trimId = "8.5x11";
    trimWhy = "large print reads best on a big page";
  } else if (bookType === "puzzle" || bookType === "activity") {
    trimId = "8.5x11";
    trimWhy = "puzzle and activity books sell best at letter size";
  } else if (bookType === "mystery") {
    trimId = "8.5x11";
    trimWhy = "the puzzles that hold the clues need room to solve on the page";
  } else if (kids) {
    trimId = "8.5x11";
    trimWhy = "kids need room to write and draw";
  } else if (bookType === "planner") {
    trimId = "8.5x11";
    trimWhy = "planner pages need room for schedules and lists";
  }
  return { bookType, trimId, reasons: { bookType: why, trimId: trimWhy } };
}
