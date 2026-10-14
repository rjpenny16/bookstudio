/**
 * Amazon Books browse categories that suit KDP print books of the kinds
 * BookStudio makes.
 *
 * KDP's category picker lists these under the Books store, e.g.
 * "Humor & Entertainment › Puzzles & Games › Sudoku". This is a curated subset,
 * not the whole tree, and Amazon reorganises it from time to time: confirm the
 * exact path in KDP's picker before publishing (same `verify` policy as
 * `rules.ts`). Like the rule set, it is versioned in one place so the listing
 * task, the critique and the Listing tab all read the same list.
 */

import type { BookType } from "@/lib/schema/project";

export const CATEGORIES_VERSION = "amazon-books-2026.10";

export interface KdpCategory {
  /** Path below "Books", levels separated by " > ". */
  path: string;
  /** Book types this category usually fits. */
  bookTypes: BookType[];
  /** Topic words that point at this category. */
  tags: string[];
  /** Children's category: only for books aimed at kids. */
  kids?: boolean;
}

const PUZZLE: BookType[] = ["puzzle", "activity", "mystery"];
const JOURNAL: BookType[] = ["journal", "notebook"];
const PLANNER: BookType[] = ["planner", "log-book", "journal"];
const LOG: BookType[] = ["log-book", "journal", "notebook"];

export const KDP_CATEGORIES: KdpCategory[] = [
  // Murder mysteries: the story's genre, for browsers of crime fiction (the puzzle categories below fit them too).
  { path: "Mystery, Thriller & Suspense > Mystery > Cozy", bookTypes: ["mystery"], tags: ["cozy", "village", "manor", "tea", "cat", "bakery", "garden", "murder", "mystery"] },
  { path: "Mystery, Thriller & Suspense > Mystery > Amateur Sleuths", bookTypes: ["mystery"], tags: ["sleuth", "amateur", "detective", "whodunit", "murder", "mystery"] },
  { path: "Mystery, Thriller & Suspense > Mystery > Police Procedurals", bookTypes: ["mystery"], tags: ["police", "inspector", "detective", "procedural", "case", "crime"] },
  { path: "Children's Books > Mysteries & Detectives", bookTypes: ["mystery"], tags: ["mystery", "detective", "kids", "clues", "case"], kids: true },
  // Puzzles & games
  { path: "Humor & Entertainment > Puzzles & Games > Sudoku", bookTypes: PUZZLE, tags: ["sudoku", "number", "numbers", "logic"] },
  { path: "Humor & Entertainment > Puzzles & Games > Word Search", bookTypes: PUZZLE, tags: ["word", "search", "wordsearch", "find", "seek", "words"] },
  { path: "Humor & Entertainment > Puzzles & Games > Logic & Brain Teasers", bookTypes: PUZZLE, tags: ["logic", "brain", "teaser", "teasers", "cryptogram", "cryptograms", "number", "variety", "mixed", "memory", "seniors", "puzzles", "mystery", "murder", "detective", "whodunit", "clues"] },
  { path: "Humor & Entertainment > Puzzles & Games > Mazes", bookTypes: PUZZLE, tags: ["maze", "mazes", "labyrinth"] },
  { path: "Humor & Entertainment > Puzzles & Games > Word Games", bookTypes: PUZZLE, tags: ["word", "scramble", "scrambles", "anagram", "cryptogram", "cryptograms", "words", "vocabulary"] },
  { path: "Humor & Entertainment > Puzzles & Games > Puzzles", bookTypes: PUZZLE, tags: ["puzzle", "puzzles", "variety", "activity", "mixed"] },
  { path: "Humor & Entertainment > Puzzles & Games > Trivia", bookTypes: PUZZLE, tags: ["trivia", "quiz", "facts"] },
  { path: "Children's Books > Activities, Crafts & Games > Activity Books", bookTypes: [...PUZZLE, "coloring", "journal", "notebook"], tags: ["activity", "activities", "kids", "children", "maze", "word", "puzzle", "puzzles", "workbook"], kids: true },
  { path: "Children's Books > Activities, Crafts & Games > Coloring Books", bookTypes: ["coloring", "activity"], tags: ["coloring", "colouring", "color", "kids"], kids: true },
  { path: "Crafts, Hobbies & Home > Coloring Books for Grown-Ups", bookTypes: ["coloring"], tags: ["coloring", "colouring", "adult", "mandala", "relaxation"] },

  // Journals & self-help
  { path: "Self-Help > Journal Writing", bookTypes: JOURNAL, tags: ["journal", "journaling", "prompts", "prompt", "writing", "diary", "reflection", "notebook"] },
  { path: "Self-Help > Personal Transformation", bookTypes: JOURNAL, tags: ["self", "discovery", "growth", "transformation", "mindset", "reflection", "habits"] },
  { path: "Self-Help > Happiness", bookTypes: JOURNAL, tags: ["gratitude", "happiness", "happy", "joy", "positivity", "positive", "affirmations"] },
  { path: "Self-Help > Stress Management", bookTypes: JOURNAL, tags: ["stress", "calm", "anxiety", "mindfulness", "relaxation", "burnout", "nurses", "self-care"] },
  { path: "Self-Help > Motivational", bookTypes: JOURNAL, tags: ["motivation", "motivational", "goals", "affirmations", "confidence", "success"] },
  { path: "Self-Help > Self-Esteem", bookTypes: JOURNAL, tags: ["self-esteem", "confidence", "self-love", "affirmations", "women", "girls"] },
  { path: "Self-Help > Spiritual", bookTypes: JOURNAL, tags: ["spiritual", "spirituality", "soul", "manifestation", "intention"] },
  { path: "Self-Help > Time Management", bookTypes: PLANNER, tags: ["planner", "productivity", "schedule", "organizer", "time", "goals", "habit", "habits"] },
  { path: "Religion & Spirituality > Christian Books & Bibles > Christian Living", bookTypes: JOURNAL, tags: ["christian", "faith", "bible", "prayer", "god", "church", "scripture"] },
  { path: "Religion & Spirituality > Worship & Devotion > Prayerbooks", bookTypes: JOURNAL, tags: ["prayer", "prayers", "devotional", "worship"] },

  // Planners & logs by subject
  { path: "Business & Money > Skills > Time Management", bookTypes: PLANNER, tags: ["planner", "productivity", "schedule", "work", "business", "organizer", "agenda"] },
  { path: "Business & Money > Personal Finance > Budgeting & Money Management", bookTypes: PLANNER, tags: ["budget", "budgeting", "money", "finance", "expense", "expenses", "savings", "bill", "bills", "debt"] },
  { path: "Business & Money > Small Business & Entrepreneurship", bookTypes: PLANNER, tags: ["business", "small", "entrepreneur", "sales", "inventory", "mileage", "orders"] },
  { path: "Education & Teaching > Teacher Resources", bookTypes: PLANNER, tags: ["teacher", "teachers", "lesson", "classroom", "school", "homeschool"] },
  { path: "Parenting & Relationships > Parenting", bookTypes: [...PLANNER, "notebook"], tags: ["baby", "parent", "parents", "mom", "dad", "newborn", "pregnancy", "kids", "family"] },
  { path: "Parenting & Relationships > Family Activities", bookTypes: [...PUZZLE, "journal"], tags: ["family", "together", "kids", "activities", "road", "trip"] },
  { path: "Health, Fitness & Dieting > Exercise & Fitness", bookTypes: LOG, tags: ["fitness", "workout", "workouts", "exercise", "gym", "training", "running", "weight"] },
  { path: "Health, Fitness & Dieting > Diets & Weight Loss", bookTypes: LOG, tags: ["diet", "food", "meal", "meals", "weight", "loss", "calorie", "calories", "nutrition"] },
  { path: "Cookbooks, Food & Wine > Cooking Education & Reference", bookTypes: LOG, tags: ["recipe", "recipes", "cooking", "baking", "kitchen", "cook"] },
  { path: "Cookbooks, Food & Wine > Beverages & Wine", bookTypes: LOG, tags: ["wine", "beer", "tasting", "cocktail", "coffee", "tea", "whiskey"] },
  { path: "Crafts, Hobbies & Home > Gardening & Landscape Design", bookTypes: LOG, tags: ["garden", "gardening", "plant", "plants", "seed", "seeds", "vegetable"] },
  { path: "Crafts, Hobbies & Home > Pets & Animal Care", bookTypes: LOG, tags: ["pet", "pets", "dog", "dogs", "cat", "cats", "horse", "chicken", "chickens", "vet"] },
  { path: "Crafts, Hobbies & Home > Crafts & Hobbies", bookTypes: [...LOG, "puzzle"], tags: ["craft", "crafts", "hobby", "hobbies", "knitting", "crochet", "sewing", "quilting"] },
  { path: "Crafts, Hobbies & Home > Antiques & Collectibles", bookTypes: LOG, tags: ["collection", "collector", "collectibles", "coins", "stamps", "cards"] },
  { path: "Sports & Outdoors > Hunting & Fishing > Fishing", bookTypes: LOG, tags: ["fishing", "fish", "angler", "anglers", "fly", "catch"] },
  { path: "Sports & Outdoors > Hunting & Fishing > Hunting", bookTypes: LOG, tags: ["hunting", "hunter", "hunters", "deer", "game"] },
  { path: "Sports & Outdoors > Hiking & Camping", bookTypes: LOG, tags: ["hiking", "hike", "camping", "camp", "trail", "outdoors", "national", "parks"] },
  { path: "Sports & Outdoors > Golf", bookTypes: LOG, tags: ["golf", "golfer", "scorecard"] },
  { path: "Travel > Travel Writing", bookTypes: [...LOG, "journal"], tags: ["travel", "trip", "vacation", "adventure", "road", "passport"] },
  { path: "Engineering & Transportation > Automotive", bookTypes: LOG, tags: ["car", "vehicle", "auto", "mileage", "maintenance", "truck", "driver"] },
  { path: "Arts & Photography > Drawing", bookTypes: ["notebook", "journal"], tags: ["sketch", "sketchbook", "drawing", "draw", "art", "doodle"] },
  { path: "Arts & Photography > Music > Songbooks", bookTypes: ["notebook"], tags: ["music", "song", "songwriting", "manuscript", "staff", "lyrics"] },
  { path: "Health, Fitness & Dieting > Aging", bookTypes: [...PUZZLE, "journal"], tags: ["seniors", "senior", "elderly", "aging", "memory", "retirement"] },
];

/** Canonical form for comparing category paths: no "Books" root, " > " separators, lower case. */
function canon(path: string): string {
  return path
    .replace(/[›»/|]/g, ">")
    .split(">")
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((p, i) => !(i === 0 && (p === "books" || p === "kindle store" || p === "kindle ebooks")))
    .join(" > ");
}

const BY_CANON = new Map(KDP_CATEGORIES.map((c) => [canon(c.path), c]));

/**
 * Map a category someone typed (or a model proposed) onto a known category.
 * Exact path first, then a unique match on the last level. Returns null when
 * nothing fits.
 */
export function matchCategory(input: string): KdpCategory | null {
  const c = canon(input);
  if (!c) return null;
  const exact = BY_CANON.get(c);
  if (exact) return exact;
  const leaf = c.split(" > ").pop()!;
  const byLeaf = KDP_CATEGORIES.filter((k) => canon(k.path).split(" > ").pop() === leaf);
  if (byLeaf.length === 1) return byLeaf[0];
  // A known path that ends with the given (shorter) path, e.g. "Puzzles & Games > Sudoku".
  const suffix = KDP_CATEGORIES.filter((k) => canon(k.path).endsWith(` > ${c}`));
  return suffix.length === 1 ? suffix[0] : null;
}

export const isKnownCategory = (path: string) => matchCategory(path) !== null;

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9-]+/).filter((w) => w.length > 1);
const isKids = (audience: string) => /\b(kid|kids|child|children|boys|girls|toddler|preschool|ages?\s*\d)/i.test(audience);

/**
 * Rank the known categories for a book. Book type has to fit; topic and
 * audience words decide the order. Children's categories only for kids' books.
 */
export function suggestCategories(book: { bookType: BookType; topic: string; audience: string }, limit = 8): string[] {
  const kids = isKids(book.audience) || isKids(book.topic);
  const terms = new Set([...words(book.topic), ...words(book.audience)]);
  const scored = KDP_CATEGORIES.filter((c) => c.bookTypes.includes(book.bookType) && (!c.kids || kids)).map((c, i) => {
    let score = 0;
    for (const t of c.tags) if (terms.has(t)) score += 3;
    for (const w of words(c.path)) if (terms.has(w)) score += 1;
    if (c.kids && kids) score += 4;
    // Keep list order as a stable tie-break: the general category for each type comes first.
    return { path: c.path, score, i };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.path);
}

/** Map proposed categories onto known ones, drop duplicates and unknowns, and top up from suggestions. */
export function resolveCategories(proposed: string[], suggestions: string[], max = 3): { categories: string[]; dropped: string[] } {
  const out: string[] = [];
  const dropped: string[] = [];
  for (const p of proposed) {
    const m = matchCategory(p);
    if (!m) {
      if (p.trim()) dropped.push(p);
      continue;
    }
    if (!out.includes(m.path)) out.push(m.path);
  }
  for (const s of suggestions) if (out.length < max && !out.includes(s)) out.push(s);
  return { categories: out.slice(0, max), dropped };
}
