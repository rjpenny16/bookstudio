import { describe, expect, it } from "vitest";
import { planSections, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { applyContent, contentCount, refineContent, type ContentRequest } from "@/lib/agent/content";
import { syncTitlePage } from "@/lib/agent/autopilot";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { offlineTask } from "@/lib/ai/offline";
import { PROMPT_BANK } from "@/lib/ai/offlineBanks";
import { taskPrompt } from "@/lib/ai/tasks";
import { buildCover, COVER_TEMPLATES, PALETTES } from "@/lib/cover/templates";
import { isKnownCategory, matchCategory, resolveCategories, suggestCategories } from "@/lib/kdp/categories";
import { coverGeometry } from "@/lib/kdp/geometry";
import { validateListing } from "@/lib/metadata/validate";
import { applyRevisedListing, qualityReport } from "@/lib/quality";
import { checkBookContent, checkPrompts, cleanPhrases, cleanPrompts, cleanWordList, nearDuplicate, repeatedPuzzles } from "@/lib/quality/content";
import { checkDesign } from "@/lib/quality/design";
import { critiqueListingRules } from "@/lib/quality/listing";
import { createProject } from "@/lib/schema/factory";
import type { BookType, Project } from "@/lib/schema/project";
import { contrastRatio, legibleOn } from "@/lib/util/color";

/** Answer content requests the way autopilot does offline. */
const offlineAsk = async ({ need, count, avoid, sectionTitle }: ContentRequest) => {
  const audience = "adults";
  if (need.task === "journal-prompts") return { output: offlineTask("journal-prompts", { topic: need.theme, audience, count, sectionTitle, avoid }) };
  if (need.task === "word-lists") return { output: offlineTask("word-lists", { topic: need.theme, audience, count, wordsPerPuzzle: need.wordsPerPuzzle, maxLength: need.maxLength, avoid }) };
  return { output: offlineTask("phrases", { topic: need.theme, audience, count, maxLength: need.maxLength, style: need.style, avoid }) };
};

async function plannedBook(bookType: BookType, topic: string, audience: string, trimId: string, pageTarget: number) {
  const ctx = { bookType, topic, audience, notes: "" };
  const bp = validateBlueprint(recipeBlueprint(ctx), ctx).blueprint;
  const planned = planSections(bp, { ...ctx, trimId, pageTarget });
  const written: PlannedSection[] = [];
  for (const s of planned) {
    if (!s.content) written.push(s);
    else written.push({ ...s, config: applyContent(s.config, s.content, (await offlineAsk({ need: s.content, sectionTitle: s.label, count: s.content.count, avoid: [] })).output, undefined) });
  }
  return written;
}

describe("content checks", () => {
  it("spots repeated prompts, including light rewording", () => {
    expect(nearDuplicate("What made you smile today?", "What made you smile today, and why?")).toBe(true);
    expect(nearDuplicate("Describe a place where you feel calm.", "Describe a place where you feel calm and safe.")).toBe(true);
    expect(nearDuplicate("What made you smile today?", "Describe the house you grew up in.")).toBe(false);
    const r = cleanPrompts(["1. What made you smile today?", "What made you smile today, and why?", "  Describe the house you grew up in.  ", "Write about [topic]."], ["Describe the house you grew up in, room by room."]);
    expect(r.kept).toEqual(["What made you smile today?"]);
    expect(r.dropped.map((d) => d.reason).sort()).toEqual(["duplicate", "duplicate", "unusable"]);
  });

  it("flags weak prompts without dropping them", () => {
    const issues = checkPrompts(["Do you like tea?", "Gratitude.", "Describe the best meal you have eaten this year and who was there."]);
    expect(issues.some((i) => i.message.startsWith("Yes/no"))).toBe(true);
    expect(issues.some((i) => i.message.startsWith("Too short"))).toBe(true);
    expect(issues.filter((i) => i.item?.startsWith("Describe"))).toEqual([]);
  });

  it("cleans word lists: plurals, hidden words, length, family-friendliness", () => {
    const r = cleanWordList(["sun", "sunflower", "tree", "trees", "ice cream", "photosynthesis", "beer", "rose", "Rose", "x"], { maxLength: 12 });
    expect(r.kept).toEqual(["SUNFLOWER", "TREE", "ICECREAM", "ROSE"]);
    const reasons = Object.fromEntries(r.dropped.map((d) => [d.item, d.reason]));
    expect(reasons.sun).toBe("hidden inside a longer word");
    expect(reasons.trees).toBe("duplicate");
    expect(reasons.photosynthesis).toMatch(/longer than 12/);
    expect(reasons.beer).toBe("not family-friendly");
    // Scrambles keep hidden words (they are solved one at a time) but drop unscramblable ones.
    expect(cleanWordList(["sun", "sunflower", "aaa"], { maxLength: 10, scramble: true }).kept).toEqual(["SUN", "SUNFLOWER"]);
  });

  it("finds puzzles that repeat another puzzle", () => {
    const fruit = ["apple", "banana", "cherry", "grape", "lemon", "mango"];
    const r = repeatedPuzzles([
      { title: "Fruits", words: fruit },
      { title: "More Fruits", words: [...fruit.slice(0, 4), "kiwi", "plum"] },
      { title: "fruits", words: ["oak", "elm", "ash", "fir", "yew", "pine"] },
      { title: "Trees", words: ["maple", "birch", "cedar", "willow", "spruce", "aspen"] },
    ]);
    expect(r.map((x) => x.index)).toEqual([1, 2]);
  });

  it("drops attributed quotations from cryptogram sayings", () => {
    const r = cleanPhrases(["Practice makes perfect.", "Be the change you wish to see. - Mahatma Gandhi", "Practice makes perfect!"], "saying", 90);
    expect(r.kept).toEqual(["Practice makes perfect."]);
  });

  it("reports the same prompt in two sections", () => {
    const sections = [
      { id: "a", label: "Mornings", config: { kind: "journal-prompts" as const, prompts: ["What made you smile today?", "Describe your ideal morning routine in detail."], spacingIn: 0.3 } },
      { id: "b", label: "Evenings", config: { kind: "journal-prompts" as const, prompts: ["What made you smile today, and why?"], spacingIn: 0.3 } },
    ];
    const out = checkBookContent(sections);
    expect(out).toHaveLength(1);
    expect(out[0].sectionId).toBe("b");
    expect(out[0].issues[0].message).toBe('Also used in "Mornings"');
  });

  it("the offline banks pass their own checks", () => {
    expect(checkPrompts(PROMPT_BANK).filter((i) => i.severity !== "low")).toEqual([]);
    const lists = offlineTask("word-lists", { topic: "animals", audience: "kids", count: 60, wordsPerPuzzle: 15, maxLength: 12 }).puzzles;
    expect(lists.length).toBe(60);
    expect(repeatedPuzzles(lists)).toEqual([]);
    const avoid = lists.slice(0, 10).map((p) => p.title);
    const more = offlineTask("word-lists", { topic: "animals", audience: "kids", count: 5, wordsPerPuzzle: 15, maxLength: 12, avoid }).puzzles;
    expect(more.some((p) => avoid.includes(p.title))).toBe(false);
  });
});

describe("content refinement", () => {
  it("replaces repeats across sections with new items", async () => {
    const same = ["What made you smile today?", "Write about a time you were brave.", "What are you ready to let go of?"];
    const sections: PlannedSection[] = ["One", "Two"].map((label) => ({
      label,
      subtitle: "",
      kind: "journal-prompts",
      config: { kind: "journal-prompts", prompts: [...same], spacingIn: 0.3 },
      content: { task: "journal-prompts", theme: "everyday life", count: 3 },
    }));
    const asked: ContentRequest[] = [];
    const r = await refineContent(sections, async (req) => {
      asked.push(req);
      return offlineAsk(req);
    });
    expect(asked).toHaveLength(1);
    expect(asked[0].sectionTitle).toBe("Two");
    expect(asked[0].avoid).toEqual(same);
    expect(r.removed).toBe(3);
    expect(r.added).toBe(3);
    const all = r.sections.flatMap((s) => (s.config.kind === "journal-prompts" ? s.config.prompts : []));
    expect(all).toHaveLength(6);
    expect(checkPrompts(all).filter((i) => i.severity === "high")).toEqual([]);
  });

  it("keeps a section short rather than repeating when no replacements come back", async () => {
    const sections: PlannedSection[] = [
      { label: "A", subtitle: "", kind: "cryptogram", config: { kind: "cryptogram", phrases: ["Practice makes perfect.", "Practice makes perfect."], difficulty: "easy", perPage: 1, solutions: true, seed: 1 }, content: { task: "phrases", theme: "x", count: 2, maxLength: 120, style: "saying" } },
    ];
    const r = await refineContent(sections, async () => ({ output: { phrases: ["Practice makes perfect!"] } }));
    expect(contentCount(r.sections[0].config)).toBe(1);
    expect(r.notes.some((n) => n.startsWith("A: needed 2, kept 1"))).toBe(true);
  });

  it.each([
    ["journal", "self-discovery journal", "women", "6x9", 160],
    ["puzzle", "variety puzzles", "adults", "6x9", 140],
    ["puzzle", "ocean animals word search", "kids ages 6-9", "8.5x11", 100],
    ["puzzle", "cryptogram puzzles", "adults", "6x9", 120],
  ] as [BookType, string, string, string, number][])("offline %s (%s) ends with no high-severity content issues", async (bookType, topic, audience, trim, target) => {
    const written = await plannedBook(bookType, topic, audience, trim, target);
    const r = await refineContent(written, offlineAsk);
    const issues = checkBookContent(r.sections.map((s, i) => ({ id: String(i), label: s.label, config: s.config })));
    expect(issues.flatMap((s) => s.issues.filter((i) => i.severity === "high"))).toEqual([]);
  });
});

describe("KDP categories", () => {
  it("matches categories however they are written", () => {
    expect(matchCategory("Books > Self-Help > Journal Writing")?.path).toBe("Self-Help > Journal Writing");
    expect(matchCategory("Books › Humor & Entertainment › Puzzles & Games › Sudoku")?.path).toBe("Humor & Entertainment > Puzzles & Games > Sudoku");
    expect(matchCategory("Puzzles & Games > Mazes")?.path).toBe("Humor & Entertainment > Puzzles & Games > Mazes");
    expect(matchCategory("Sudoku")?.path).toBe("Humor & Entertainment > Puzzles & Games > Sudoku");
    expect(matchCategory("Books > Made Up > Bestsellers")).toBeNull();
    expect(isKnownCategory("")).toBe(false);
  });

  it("suggests categories that fit the book type and audience", () => {
    expect(suggestCategories({ bookType: "puzzle", topic: "large print sudoku", audience: "seniors" })[0]).toBe("Humor & Entertainment > Puzzles & Games > Sudoku");
    expect(suggestCategories({ bookType: "log-book", topic: "fishing log book", audience: "anglers" })[0]).toBe("Sports & Outdoors > Hunting & Fishing > Fishing");
    const adult = suggestCategories({ bookType: "puzzle", topic: "word search", audience: "adults" }, 50);
    expect(adult.some((c) => c.startsWith("Children's"))).toBe(false);
    const kids = suggestCategories({ bookType: "puzzle", topic: "word search", audience: "kids ages 6-9" }, 3);
    expect(kids).toContain("Children's Books > Activities, Crafts & Games > Activity Books");
  });

  it("resolves proposed categories onto known ones", () => {
    const r = resolveCategories(["Books > Humor & Entertainment > Puzzles & Games > Sudoku", "Books > Fake > Thing", "sudoku"], ["Humor & Entertainment > Puzzles & Games > Logic & Brain Teasers"]);
    expect(r.categories).toEqual(["Humor & Entertainment > Puzzles & Games > Sudoku", "Humor & Entertainment > Puzzles & Games > Logic & Brain Teasers"]);
    expect(r.dropped).toEqual(["Books > Fake > Thing"]);
  });
});

function sampleProject(bookType: BookType = "puzzle"): Project {
  const p = createProject({ name: "Big Sudoku", bookType, trimId: "8.5x11", paper: "white", ink: "black", bleed: false, author: "Ada", interior: [{ kind: "sudoku", count: 120, difficulty: "easy", perPage: 1, solutions: true, seed: 1 }] });
  p.brief.topic = "large print sudoku";
  p.brief.audience = "seniors";
  return p;
}

describe("listing critique rules", () => {
  it("flags stuffing, vague descriptions and wrong categories", () => {
    const p = sampleProject();
    p.metadata.title = "Sudoku Sudoku Puzzles";
    p.metadata.subtitle = "Large Print Sudoku for Seniors | 120 pages, 8.5x11";
    p.metadata.description = "A great sudoku book for anyone who loves sudoku puzzles and wants to relax with them every day.";
    p.metadata.keywords = ["sudoku", "puzzles", "book"];
    p.metadata.categories = ["Self-Help > Journal Writing", "Books > Puzzles > Super Sudoku"];
    const notes = critiqueListingRules(p.metadata, { bookType: "puzzle", topic: "sudoku", audience: "seniors", pageCount: 130 });
    const issues = notes.map((n) => `${n.field}:${n.severity}:${n.issue}`);
    expect(issues.some((i) => i.startsWith("subtitle:high") && i.includes("sudoku"))).toBe(true);
    expect(issues.some((i) => i.startsWith("subtitle:low") && i.includes("page count"))).toBe(true);
    expect(issues.some((i) => i.startsWith("description:medium:Description never gives a number"))).toBe(true);
    expect(issues.some((i) => i.startsWith("keywords:medium") && i.includes("4 keyword slot"))).toBe(true);
    expect(issues.some((i) => i.startsWith("categories:medium") && i.includes("Super Sudoku"))).toBe(true);
    expect(issues.some((i) => i.startsWith("categories:medium") && i.includes("not a usual home"))).toBe(true);
    expect(validateListing(p.metadata, "puzzle").warnings.some((w) => w.includes("Super Sudoku"))).toBe(true);
  });

  it("applies a revision only when it doesn't add listing errors", () => {
    const p = sampleProject();
    p.metadata.title = "Big Sudoku";
    p.metadata.description = "x".repeat(200);
    const good = applyRevisedListing(p, { title: "Big Print Sudoku", subtitle: "Easy puzzles for seniors", description: "y".repeat(300), keywords: ["easy sudoku for seniors"], categories: ["Sudoku", "Fake > Category"] });
    expect(good.changed).toEqual(["title", "subtitle", "description", "keywords", "categories"]);
    expect(good.metadata.categories).toEqual(["Humor & Entertainment > Puzzles & Games > Sudoku"]);
    const bad = applyRevisedListing(p, { title: "Bestseller Sudoku", subtitle: "", description: "z", keywords: [], categories: [] });
    expect(bad.changed).toEqual([]);
    expect(bad.metadata).toBe(p.metadata);
  });
});

describe("design checks", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("red", "#fff")).toBeNull();
    expect(legibleOn("#ffffff", "#95d5b2", ["#1b4332"])).toBe("#1b4332");
    expect(legibleOn("#ffffff", "#14213d", ["#ffffff"])).toBe("#14213d");
  });

  it("every built-in template and palette keeps the cover text readable", () => {
    const p = sampleProject();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    for (const t of COVER_TEMPLATES)
      for (const palette of PALETTES) {
        const cover = buildCover(t.id, { title: "Large Print Sudoku", subtitle: "Easy puzzles for seniors", author: "Ada", backText: "A back blurb.", palette }, cg);
        const notes = checkDesign({ ...p, cover: { ...p.cover, ...cover } }).filter((n) => n.area === "cover" && n.severity !== "low");
        expect(notes, `${t.id}/${palette.id}`).toEqual([]);
      }
  });

  it("flags low contrast and a title that vanishes as a thumbnail", () => {
    const p = sampleProject();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    p.cover.background = "#ffffff";
    p.cover.elements = [{ id: "t", type: "text", name: "Title", text: "Tiny", x: cg.frontSafe.x, y: cg.frontSafe.y, width: 200, height: 20, rotation: 0, fontFamily: "Inter", bold: true, fontSize: 14, color: "#dddddd", align: "left", lineHeight: 1 }];
    const notes = checkDesign(p).map((n) => `${n.severity}:${n.issue}`);
    expect(notes.some((n) => n.startsWith("high:The title would be about"))).toBe(true);
    expect(notes.some((n) => n.startsWith("high:Title has very low contrast"))).toBe(true);
  });

  it("puts it together in a quality report", () => {
    const p = sampleProject();
    const r = qualityReport(p);
    expect(r.counts.high + r.counts.medium + r.counts.low).toBe(r.listing.length + r.design.length + r.content.reduce((n, s) => n + s.issues.length, 0));
    expect(r.listing.some((n) => n.field === "categories")).toBe(true);
  });
});

describe("prompts and sync", () => {
  it("tells the model what to avoid", () => {
    const withAvoid = taskPrompt("journal-prompts", { topic: "t", audience: "a", count: 3, sectionTitle: "Mornings", avoid: ["Old prompt"] });
    expect(withAvoid).toContain('for the section "Mornings"');
    expect(withAvoid).toContain("Do not repeat or paraphrase");
    expect(taskPrompt("journal-prompts", { topic: "t", audience: "a", count: 3 })).not.toContain("Do not repeat or paraphrase");
    expect(taskPrompt("listing", { topic: "t", audience: "a", bookType: "puzzle", angle: "", workingTitle: "", author: "", interiorSummary: "", pageCount: 100, trim: "6x9", keywordIdeas: [], categoryOptions: ["X > Y"] })).toContain("copied exactly");
  });

  it("regenerates the title page when the listing title changes", () => {
    const p = createProject({ name: "Old", bookType: "journal", trimId: "6x9", paper: "white", ink: "black", bleed: false, interior: [{ label: "Title page", role: "front", config: { kind: "title-page", title: "Old", subtitle: "", author: "A" } }, { kind: "lined", count: 23, spacingIn: 0.3, header: false }] });
    expect(syncTitlePage(p)).toBe(p);
    const changed = { ...p, metadata: { ...p.metadata, title: "New Title", subtitle: "Sub" } };
    const next = syncTitlePage(changed);
    expect(next.interior.pages).toHaveLength(p.interior.pages.length);
    const texts = next.interior.pages[0].elements.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : ""));
    expect(texts).toContain("New Title");
    expect(next.interior.pages[0].sectionId).toBe(p.interior.pages[0].sectionId);
  });
});
