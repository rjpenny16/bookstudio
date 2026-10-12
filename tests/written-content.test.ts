import { describe, expect, it } from "vitest";
import { planSections, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { BATCH_SIZE, refineContent, reviewContent, weakItems, writeSection, type ContentRequest } from "@/lib/agent/content";
import { estimateRun } from "@/lib/agent/estimate";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { offlineAffirmations, offlinePrompts, offlineTask, orientationOf } from "@/lib/ai/offline";
import { AFFIRMATION_BANK, PROMPT_BANK } from "@/lib/ai/offlineBanks";
import { AFFIRMATION_TOPICS, PROMPT_TOPICS } from "@/lib/ai/offlineTopics";
import { taskPrompt } from "@/lib/ai/tasks";
import { checkBookContent, checkSectionContent, nearDuplicate, openerKey, phraseProblems, promptProblems } from "@/lib/quality/content";
import type { BookType } from "@/lib/schema/project";

const offlineAsk = async ({ need, count, avoid, sectionTitle }: ContentRequest) => {
  const audience = "adults";
  if (need.task === "journal-prompts") return { output: offlineTask("journal-prompts", { topic: need.theme, audience, count, sectionTitle, avoid }) };
  if (need.task === "word-lists") return { output: offlineTask("word-lists", { topic: need.theme, audience, count, wordsPerPuzzle: need.wordsPerPuzzle, maxLength: need.maxLength, avoid }) };
  if (need.task === "crossword-clues") return { output: offlineTask("crossword-clues", { topic: need.theme, audience, count, entriesPerPuzzle: need.entriesPerPuzzle, maxLength: need.maxLength, difficulty: need.difficulty, avoid }) };
  return { output: offlineTask("phrases", { topic: need.theme, audience, count, maxLength: need.maxLength, style: need.style, avoid }) };
};

const promptSection = (count: number, prompts: string[] = [], theme = "nursing: memories and reflection"): PlannedSection => ({
  label: "Looking Back",
  subtitle: "",
  kind: "journal-prompts",
  config: { kind: "journal-prompts", prompts, spacingIn: 0.3 },
  content: { task: "journal-prompts", theme, count },
});

const allPrompts = [...PROMPT_BANK, ...PROMPT_TOPICS.flatMap((t) => [...t.prompts.back, ...t.prompts.now, ...t.prompts.ahead])];
const allAffirmations = [...AFFIRMATION_BANK, ...AFFIRMATION_TOPICS.flatMap((t) => t.affirmations)];

function duplicates(items: string[]): [string, string][] {
  const out: [string, string][] = [];
  items.forEach((a, i) => items.slice(0, i).forEach((b) => nearDuplicate(a, b) && out.push([b, a])));
  return out;
}

describe("offline banks", () => {
  it("every prompt is open, concrete enough and distinct from every other", () => {
    expect(allPrompts.flatMap((p) => promptProblems(p).map((i) => `${p}: ${i.message}`))).toEqual([]);
    expect(duplicates(allPrompts)).toEqual([]);
    expect(allPrompts.every((p) => p.length <= 140)).toBe(true);
  });

  it("every affirmation is first person, short enough for a gratitude page and distinct", () => {
    expect(allAffirmations.flatMap((a) => phraseProblems(a, "affirmation", 90).map((i) => `${a}: ${i.message}`))).toEqual([]);
    expect(duplicates(allAffirmations)).toEqual([]);
  });

  it("each topic bank has prompts for looking back, now and ahead", () => {
    for (const t of PROMPT_TOPICS) for (const l of ["back", "now", "ahead"] as const) expect(t.prompts[l].length, `${t.id} ${l}`).toBeGreaterThanOrEqual(8);
  });
});

describe("offline text matched to the book", () => {
  it("reads which way a section looks from its title and theme", () => {
    expect(orientationOf("Looking Back journal: memories and reflection")).toBe("back");
    expect(orientationOf("Right Now journal: the present moment and gratitude")).toBe("now");
    expect(orientationOf("Looking Ahead journal: hopes, plans and growth")).toBe("ahead");
    expect(orientationOf("Small wins on a hard shift")).toBeNull();
  });

  it("a nurse's journal opens each section with nursing prompts that look the same way", () => {
    const nursing = PROMPT_TOPICS.find((t) => t.id === "nursing")!;
    const back = offlinePrompts({ topic: "Guided journal for nurses: memories and reflection", audience: "Nurses", sectionTitle: "Looking Back", count: 36 });
    const ahead = offlinePrompts({ topic: "Guided journal for nurses: hopes, plans and growth", audience: "Nurses", sectionTitle: "Looking Ahead", count: 36 });
    expect(back).toHaveLength(36);
    // All of them, give or take one deferred to keep the openings varied ("Write about…").
    expect(back.filter((p) => nursing.prompts.back.includes(p)).length).toBeGreaterThanOrEqual(nursing.prompts.back.length - 1);
    expect(ahead.filter((p) => nursing.prompts.ahead.includes(p)).length).toBeGreaterThanOrEqual(nursing.prompts.ahead.length - 1);
    // Spread through the section rather than bunched at the start.
    expect(back.slice(18).some((p) => nursing.prompts.back.includes(p))).toBe(true);
    expect(back.some((p) => nursing.prompts.now.includes(p))).toBe(false);
  });

  it("a book with no topic bank gets general prompts, and other readers' banks stay out", () => {
    const ps = offlinePrompts({ topic: "Self-discovery journal: memories and reflection", audience: "women", sectionTitle: "Looking Back", count: 30 });
    const topical = new Set(PROMPT_TOPICS.flatMap((t) => [...t.prompts.back, ...t.prompts.now, ...t.prompts.ahead]));
    expect(ps.filter((p) => topical.has(p))).toEqual([]);
    expect(ps).toHaveLength(30);
  });

  it("keeps openings varied", () => {
    for (const topic of ["Journal for teachers", "Travel journal", "Daily journal"]) {
      const ps = offlinePrompts({ topic, audience: "adults", count: 40 });
      const counts = new Map<string, number>();
      for (const p of ps) counts.set(openerKey(p), (counts.get(openerKey(p)) ?? 0) + 1);
      expect(Math.max(...counts.values()), topic).toBeLessThanOrEqual(Math.ceil(40 * 0.15));
    }
  });

  it("a gratitude journal's affirmations lead with ones written for it", () => {
    const as = offlineAffirmations({ topic: "Daily gratitude journal", audience: "Women who want a calm five-minute morning routine", count: 30, maxLength: 90 });
    const matched = AFFIRMATION_TOPICS.filter((t) => t.match.test("Daily gratitude journal Women who want a calm five-minute morning routine"));
    expect(matched.map((t) => t.id)).toEqual(["gratitude", "calm", "wellness"]);
    const topical = new Set(matched.flatMap((t) => t.affirmations));
    expect(as.filter((a) => topical.has(a)).length).toBe(20);
    expect(as.some((a) => AFFIRMATION_TOPICS[0].affirmations.includes(a))).toBe(true);
  });
});

describe("batched writing", () => {
  it("writes long sections in batches, each told what earlier batches said", async () => {
    const asked: ContentRequest[] = [];
    const r = await writeSection(promptSection(100, [], "Guided journal for nurses"), async (req) => {
      asked.push(req);
      return offlineAsk(req);
    });
    expect(asked.length).toBeGreaterThanOrEqual(4);
    expect(asked.every((a) => a.count <= BATCH_SIZE)).toBe(true);
    expect(asked[0].avoid).toEqual([]);
    expect(asked[1].avoid).toHaveLength(30);
    expect(asked[3].avoid.length).toBeGreaterThanOrEqual(90);
    expect(r.config.kind === "journal-prompts" && r.config.prompts).toHaveLength(100);
    expect(r.batches).toBe(asked.length);
    expect(checkSectionContent(r.config).filter((i) => i.severity !== "low")).toEqual([]);
  });

  it("also avoids items already in the book", async () => {
    const before = ["Describe the moment you knew you wanted to work in care."];
    const asked: ContentRequest[] = [];
    const r = await writeSection(promptSection(10, [], "Guided journal for nurses"), async (req) => {
      asked.push(req);
      return offlineAsk(req);
    }, before);
    expect(asked[0].avoid).toEqual(before);
    expect(r.config.kind === "journal-prompts" && r.config.prompts.some((p) => nearDuplicate(p, before[0]))).toBe(false);
  });

  it("stops when a batch brings nothing new", async () => {
    let calls = 0;
    const r = await writeSection(promptSection(90), async () => {
      calls++;
      return { output: { prompts: ["Write about a time you were brave and what it taught you."] } };
    });
    expect(calls).toBe(2);
    expect(r.config.kind === "journal-prompts" && r.config.prompts).toHaveLength(1);
  });

  it("gives every gratitude page its own affirmation", async () => {
    const ctx = { bookType: "journal" as BookType, topic: "Daily gratitude journal", audience: "Women who want a calm five-minute morning routine", notes: "" };
    const planned = planSections(validateBlueprint(recipeBlueprint(ctx), ctx).blueprint, { ...ctx, trimId: "6x9", pageTarget: 120 });
    const g = planned.find((s) => s.config.kind === "gratitude")!;
    expect(g.content?.count).toBe(g.config.kind === "gratitude" && g.config.count);
    const r = await writeSection(g, async (req) => ({ output: offlineTask("phrases", { topic: req.need.theme, audience: ctx.audience, count: req.count, maxLength: 90, style: "affirmation", avoid: req.avoid }) }));
    const affirmations = r.config.kind === "gratitude" ? r.config.affirmations ?? [] : [];
    expect(affirmations.length).toBe(g.content!.count);
    expect(duplicates(affirmations)).toEqual([]);
    expect(checkSectionContent(r.config)).toEqual([]);
  });

  it("flags a gratitude section with fewer affirmations than pages", () => {
    const issues = checkSectionContent({ kind: "gratitude", count: 90, affirmations: ["I notice the good things around me.", "I can do hard things."] });
    expect(issues.some((i) => i.message.startsWith("2 affirmations for 90 pages"))).toBe(true);
  });
});

describe("content review", () => {
  it("flags yes/no prompts, crowded openings and the model's picks", () => {
    const items = [
      "Do you like mornings?",
      "What is your favorite season?",
      "What is a place you love?",
      "What is a smell you remember?",
      "Describe the house you grew up in.",
      "Write about a teacher who changed your mind.",
    ];
    const weak = weakItems("prompt", items, 160, [{ item: 6, problem: "Off-theme" }, { item: 99, problem: "out of range" }]);
    expect(weak.get(0)).toMatch(/Yes\/no/);
    expect(weak.get(3)).toMatch(/Starts like 2 other items/);
    expect(weak.get(5)).toBe("Off-theme");
    expect(weak.has(1) || weak.has(2) || weak.has(4)).toBe(false);
  });

  it("rewrites weak items in place with checked replacements, at most 30% of a section", async () => {
    const good = offlinePrompts({ topic: "Daily journal", audience: "adults", count: 8 });
    const items = [...good.slice(0, 7), "Do you like tea?", "Are you happy?", "Is today good?"];
    const asked: ContentRequest[] = [];
    const r = await reviewContent([promptSection(10, items)], async () => ({ weak: [] }), async (req) => {
      asked.push(req);
      // One repeat of the section, one yes/no, then good ones.
      return { output: { prompts: [items[0], "Have you been brave?", "Describe the bravest thing you did this year.", "Write about a meal that brought people together."] } };
    });
    const out = r.sections[0].config.kind === "journal-prompts" ? r.sections[0].config.prompts : [];
    expect(r.flagged).toBe(3);
    expect(r.rewritten).toBe(2);
    expect(asked[0].feedback).toMatch(/weak items/);
    expect(asked[0].avoid).toEqual(expect.arrayContaining(items));
    expect(out.slice(0, 7)).toEqual(items.slice(0, 7));
    expect(out[7]).toBe("Describe the bravest thing you did this year.");
    expect(out[8]).toBe("Write about a meal that brought people together.");
    expect(out[9]).toBe("Is today good?");
    expect(r.notes[0]).toMatch(/flagged 3 weak item\(s\) and rewrote 2/);
  });

  it("keeps a section unchanged when nothing is weak", async () => {
    const items = offlinePrompts({ topic: "Daily journal", audience: "adults", count: 12 });
    let asks = 0;
    const r = await reviewContent([promptSection(12, items)], async () => ({ weak: [] }), async () => {
      asks++;
      return { output: { prompts: [] } };
    });
    expect(asks).toBe(0);
    expect(r.flagged).toBe(0);
    expect(r.sections[0].config).toEqual(promptSection(12, items).config);
  });

  it("a replacement never repeats another section of the book", async () => {
    const other = promptSection(1, ["Describe the bravest thing you did this year."]);
    const mine = { ...promptSection(3, ["Do you like tea?", "Describe the house you grew up in.", "Write about a teacher who changed your mind."]), label: "Right Now" };
    const r = await reviewContent([other, mine], null, async () => ({ output: { prompts: ["Describe the bravest thing you did this year.", "List five sounds that mean home to you."] } }));
    expect(r.sections[1].config.kind === "journal-prompts" && r.sections[1].config.prompts[0]).toBe("List five sounds that mean home to you.");
  });

  it("offline books come out of refine and review with nothing left to flag", async () => {
    for (const [topic, audience] of [
      ["Guided journal for nurses", "Nurses in their first years on the job"],
      ["Travel journal", "Adults who love road trips"],
      ["Self-discovery journal", "women"],
    ]) {
      const ctx = { bookType: "journal" as BookType, topic, audience, notes: "" };
      const planned = planSections(validateBlueprint(recipeBlueprint(ctx), ctx).blueprint, { ...ctx, trimId: "6x9", pageTarget: 160 });
      const written: PlannedSection[] = [];
      for (const s of planned) written.push(s.content ? { ...s, config: (await writeSection(s, offlineAsk)).config } : s);
      const refined = await refineContent(written, offlineAsk);
      const reviewed = await reviewContent(refined.sections, null, offlineAsk);
      const issues = checkBookContent(reviewed.sections.map((s, i) => ({ id: String(i), label: s.label, config: s.config })));
      expect(issues.flatMap((s) => s.issues), topic).toEqual([]);
    }
  });

  it("the review task asks for weak items only", () => {
    const p = taskPrompt("content-review", { kind: "prompt", topic: "nursing", audience: "nurses", items: ["Describe your first shift."] });
    expect(p).toMatch(/Most items should pass/);
    expect(offlineTask("content-review", { kind: "prompt", topic: "x", audience: "y", items: ["a"] })).toEqual({ weak: [] });
  });
});

describe("run estimate", () => {
  it("counts batches and the review for books with written content", () => {
    const journal = estimateRun({ bookType: "journal", provider: "anthropic", coverArt: false });
    const puzzle = estimateRun({ bookType: "puzzle", provider: "anthropic", coverArt: false });
    expect(journal.modelCalls[1]).toBeGreaterThanOrEqual(6 + 7 + 5 * 3);
    expect(journal.modelCalls[1]).toBeGreaterThan(puzzle.modelCalls[0]);
  });
});
