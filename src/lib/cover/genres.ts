import type { BookType, Project } from "@/lib/schema/project";

/**
 * Genre design profiles: what a bestselling cover in each niche tends to look
 * like. A profile names the templates and palettes that suit the genre, best
 * first, and the type system its covers are set in, so a sudoku book for
 * seniors gets a heavy condensed title on a high-contrast color and a
 * gratitude journal gets a calm display serif on soft linen, whichever
 * template is used.
 */

export type GenreId = "puzzle" | "large-print" | "kids" | "wellness" | "faith" | "journal" | "planner" | "log-book" | "mystery";

export interface TypeSystem {
  /** Display face for the main title words. */
  hero: string;
  heroBold: boolean;
  /** Set the main title words in capitals. */
  heroUpper: boolean;
  /** Face for the words around the hero ("Puzzles for Seniors") and the subtitle. */
  support: string;
  supportBold: boolean;
  /** Set the support words in tracked capitals. */
  supportUpper: boolean;
  /** Small tracked capitals above the hero ("LARGE PRINT"). */
  kicker: string;
  /** Face for the back cover blurb and lists. */
  body: string;
}

export interface GenreProfile {
  id: GenreId;
  label: string;
  /** Cover templates that suit the genre, best first. */
  templates: string[];
  /** Palettes that suit the genre, best first. */
  palettes: string[];
  type: TypeSystem;
  /** Style line for AI cover art in this genre. */
  artStyle: string;
  /** How busy a background the genre wears comfortably (share of edge pixels); see quality/coverScore. */
  clutterOk: number;
}

export const GENRES: Record<GenreId, GenreProfile> = {
  puzzle: {
    id: "puzzle",
    label: "Puzzle book",
    templates: ["puzzle", "color-blocks", "spiral", "series", "band"],
    palettes: ["newsprint", "midnight", "ocean", "royal", "charcoal"],
    type: { hero: "Bebas Neue", heroBold: false, heroUpper: true, support: "Oswald", supportBold: true, supportUpper: true, kicker: "Raleway", body: "Inter" },
    artStyle: "bold flat vector illustration with clean shapes and strong color blocks",
    clutterOk: 0.12,
  },
  "large-print": {
    id: "large-print",
    label: "Large print",
    templates: ["starburst", "color-blocks", "puzzle", "botanical"],
    palettes: ["royal", "sunny", "midnight", "newsprint"],
    type: { hero: "Archivo Black", heroBold: false, heroUpper: true, support: "Montserrat", supportBold: true, supportUpper: true, kicker: "Montserrat", body: "Inter" },
    artStyle: "cheerful, high-contrast flat illustration with large simple shapes",
    clutterOk: 0.12,
  },
  kids: {
    id: "kids",
    label: "Kids",
    templates: ["kids-bold", "playful", "rainbow", "color-blocks"],
    palettes: ["candy", "sky", "sunny", "mint"],
    type: { hero: "Lilita One", heroBold: false, heroUpper: false, support: "Fredoka", supportBold: true, supportUpper: false, kicker: "Fredoka", body: "Inter" },
    artStyle: "bright, friendly cartoon illustration with rounded shapes and thick outlines",
    clutterOk: 0.2,
  },
  wellness: {
    id: "wellness",
    label: "Gratitude & wellness journal",
    templates: ["botanical", "rainbow", "minimal", "framed"],
    palettes: ["linen", "sage", "blush", "lavender", "cream"],
    type: { hero: "DM Serif Display", heroBold: false, heroUpper: false, support: "Raleway", supportBold: false, supportUpper: true, kicker: "Raleway", body: "Lora" },
    artStyle: "soft watercolor or gouache botanical illustration with gentle light and a muted palette",
    clutterOk: 0.1,
  },
  faith: {
    id: "faith",
    label: "Faith journal",
    templates: ["framed", "label", "botanical", "minimal"],
    palettes: ["ivory-gold", "dusk", "cream", "plum"],
    type: { hero: "Playfair Display", heroBold: true, heroUpper: false, support: "Lora", supportBold: false, supportUpper: false, kicker: "Raleway", body: "Lora" },
    artStyle: "serene painterly landscape or botanical illustration with warm golden light",
    clutterOk: 0.06,
  },
  journal: {
    id: "journal",
    label: "Journal & notebook",
    templates: ["minimal", "framed", "rainbow", "label", "geometric"],
    palettes: ["cream", "sage", "terracotta", "midnight", "blush"],
    type: { hero: "DM Serif Display", heroBold: false, heroUpper: false, support: "Raleway", supportBold: false, supportUpper: true, kicker: "Raleway", body: "Lora" },
    artStyle: "elegant illustrated pattern or still life with a refined, limited palette",
    clutterOk: 0.06,
  },
  planner: {
    id: "planner",
    label: "Planner",
    templates: ["band", "geometric", "spiral", "minimal"],
    palettes: ["slate", "sage", "blush", "charcoal", "mint"],
    type: { hero: "Montserrat", heroBold: true, heroUpper: true, support: "Raleway", supportBold: false, supportUpper: true, kicker: "Raleway", body: "Inter" },
    artStyle: "modern abstract shapes or a tidy desk flat-lay, clean and minimal",
    clutterOk: 0.06,
  },
  "log-book": {
    id: "log-book",
    label: "Log book",
    templates: ["label", "band", "framed", "series"],
    palettes: ["kraft", "forest", "slate", "charcoal"],
    type: { hero: "Roboto Slab", heroBold: true, heroUpper: true, support: "Oswald", supportBold: false, supportUpper: true, kicker: "Raleway", body: "Inter" },
    artStyle: "detailed vintage field-guide illustration with a textured, natural palette",
    clutterOk: 0.1,
  },
  mystery: {
    id: "mystery",
    label: "Murder mystery",
    templates: ["framed", "minimal", "band", "label"],
    palettes: ["charcoal", "midnight", "plum", "dusk"],
    type: { hero: "Abril Fatface", heroBold: false, heroUpper: false, support: "Oswald", supportBold: false, supportUpper: true, kicker: "Oswald", body: "Lora" },
    artStyle: "moody vintage noir illustration with strong silhouettes, one warm light source and deep shadows; atmospheric, never gory",
    clutterOk: 0.1,
  },
};

const LARGE_PRINT = /large[- ]print|big print|senior|low vision|elderly|retire/i;
const KIDS = /\bkids?\b|child|children|toddler|preschool|kindergarten|\bages? \d|\bboys?\b|\bgirls?\b|teen|tween/i;
const FAITH = /faith|bible|prayer|pray|scripture|christian|devotion|\bgod\b|jesus|church|sermon/i;
const WELLNESS = /gratitude|grateful|thankful|mindful|self[- ]care|wellness|wellbeing|well-being|anxiety|affirmation|mental health|meditat|calm|reflect|healing|mood|therapy|manifest/i;

export interface GenreFacts {
  bookType: BookType | string;
  topic: string;
  audience: string;
}

/** The profile for a book, from its type and what it is about. */
export function genreOf(f: GenreFacts): GenreProfile {
  const words = `${f.topic} ${f.audience}`;
  const puzzleLike = f.bookType === "puzzle" || f.bookType === "activity";
  if (puzzleLike && LARGE_PRINT.test(words)) return GENRES["large-print"];
  // A mystery keeps its noir look even in large print (the interior grows its type instead); kids get the kids' look.
  if (f.bookType === "mystery") return KIDS.test(words) ? GENRES.kids : GENRES.mystery;
  if (f.bookType === "activity" || f.bookType === "coloring" || KIDS.test(words)) return GENRES.kids;
  if (puzzleLike) return GENRES.puzzle;
  if (f.bookType === "planner") return GENRES.planner;
  if (f.bookType === "log-book") return GENRES["log-book"];
  if (FAITH.test(words)) return GENRES.faith;
  if (WELLNESS.test(words)) return GENRES.wellness;
  return GENRES.journal;
}

export function genreOfProject(project: Project): GenreProfile {
  return genreOf({ bookType: project.bookType, topic: project.brief.topic || project.metadata.title || project.name, audience: `${project.brief.audience} ${project.metadata.subtitle}` });
}
