import { describe, expect, it } from "vitest";
import { assembleMystery, BUILT_IN_CASES, caseFile, chapterRequest, checkChapter, checkMysteryPlan, deductionPicks, editMystery, ensureSecret, judgeTest, MAX_EDITS, mysterySizing, mysteryStyle, planMystery, storyBibleProblems, testCheckpoints, writeMystery, type MysteryAsk, type MysteryInput } from "@/lib/agent/mystery";
import { pool } from "@/lib/agent/content";
import { inferSetup } from "@/lib/agent/setup";
import { offlineTask } from "@/lib/ai/offline";
import { TASKS, type MysteryPlanOutput } from "@/lib/ai/tasks";
import { genreOf } from "@/lib/cover/genres";
import { crosswordsOf, estimatePageCount, generatePages, type GeneratorConfig } from "@/lib/generators/pages";
import { secretOrder } from "@/lib/generators/scramble";
import { generateWordSearch, leftoverLetters, normalizeWord } from "@/lib/generators/wordsearch";
import { runPreflight } from "@/lib/preflight";
import { createProject } from "@/lib/schema/factory";
import type { Project, TextElement } from "@/lib/schema/project";

/** The autopilot's model calls, answered by the offline provider (validated against the task schemas, as the server does). */
const offlineAsk: MysteryAsk = async (task, input) => {
  const output = offlineTask(task, input);
  TASKS[task].output.parse(output);
  return { output };
};
const serial = <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>) => pool(items, 2, fn);

async function buildMystery(i: MysteryInput) {
  const z = mysterySizing(i);
  const planned = await planMystery(offlineAsk, z, i);
  const written = await writeMystery(offlineAsk, planned.plan, z, i.audience, serial);
  const book = assembleMystery(planned.plan, written.chapters, written.reveal, z, { ...i, subtitle: "A Whodunit Puzzle Book", author: "Ada Writer" });
  const project = createProject({ name: i.title, bookType: "mystery", trimId: i.trimId, paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: book.sections, style: mysteryStyle(i) });
  return { z, planned, written, book, project };
}

const texts = (project: Project, sectionLabel: RegExp) => {
  const ids = new Set(project.interior.sections.filter((s) => sectionLabel.test(s.label)).map((s) => s.id));
  return project.interior.pages.filter((p) => p.sectionId && ids.has(p.sectionId)).flatMap((p) => p.elements.filter((e): e is TextElement => e.type === "text").map((e) => e.text));
};

const base: MysteryInput = { topic: "Murder mystery puzzle book at a country manor", audience: "Adults who love cozy mysteries", notes: "", angle: "", title: "Death at the Manor", trimId: "8.5x11", pageTarget: 60, difficulty: "medium" };

describe("mystery setup", () => {
  it("infers the mystery book type before the puzzle type", () => {
    expect(inferSetup("Murder mystery puzzle book", "adults").bookType).toBe("mystery");
    expect(inferSetup("Detective whodunit with word searches", "teens").bookType).toBe("mystery");
    expect(inferSetup("Word search puzzles", "adults").bookType).toBe("puzzle");
    expect(inferSetup("Murder mystery puzzle book", "adults").trimId).toBe("8.5x11");
  });

  it("gets a noir cover genre, or the kids' look for children", () => {
    expect(genreOf({ bookType: "mystery", topic: "murder mystery", audience: "adults" }).id).toBe("mystery");
    expect(genreOf({ bookType: "mystery", topic: "detective mystery", audience: "kids ages 8-12" }).id).toBe("kids");
  });

  it("sizes the case to the page target", () => {
    const small = mysterySizing({ ...base, pageTarget: 40 });
    const big = mysterySizing({ ...base, pageTarget: 120 });
    expect(small.chapters).toBeGreaterThanOrEqual(6);
    expect(big.chapters * (big.cluesPerChapter + big.storyPages)).toBeGreaterThan(small.chapters * (small.cluesPerChapter + small.storyPages));
    expect(mysterySizing({ ...base, audience: "kids ages 8-12" }).kinds).not.toContain("cryptogram");
    expect(mysterySizing({ ...base, audience: "kids ages 8-12" }).difficulty).toBe("easy");
  });
});

describe("the case plan", () => {
  const z = mysterySizing(base);

  it.each(BUILT_IN_CASES.map((c) => [c.plan.caseTitle, c] as const))("built-in case %s passes the fair-play check", (_, c) => {
    const r = checkMysteryPlan(c.plan, z);
    expect(r.problems).toEqual([]);
    expect(r.fatal).toBe(false);
    expect(c.chapters).toHaveLength(c.plan.chapters.length);
    // Every chapter's puzzles match its clues, and each puzzle can hide its clue.
    c.plan.chapters.forEach((ch, n) => {
      expect(c.chapters[n].puzzles).toHaveLength(ch.clues.length);
      ch.clues.forEach((cl, k) => {
        const p = c.chapters[n].puzzles[k];
        if (cl.kind === "word-scramble") expect(secretOrder(p.words, cl.answer), `${cl.answer} from ${p.words}`).not.toBeNull();
        if (cl.kind === "crossword") expect(p.entries.map((e) => e.answer)).toContain(cl.answer);
        if (cl.kind === "word-search") expect(p.words.length).toBeGreaterThanOrEqual(8);
      });
    });
  });

  const plan = (): MysteryPlanOutput => structuredClone(BUILT_IN_CASES[0].plan);

  it("rejects a culprit who isn't a suspect", () => {
    const p = plan();
    p.culprit = "The Butler";
    const r = checkMysteryPlan(p, z);
    expect(r.fatal).toBe(true);
    expect(r.problems.join(" ")).toMatch(/not one of the suspects/);
  });

  it("asks for clues against the culprit and a clue clearing every innocent suspect", () => {
    const p = plan();
    for (const ch of p.chapters) ch.clues = ch.clues.filter((cl) => !(cl.suspect === "Victor Lane" && cl.effect === "implicates") && cl.suspect !== "Agnes Pell");
    const r = checkMysteryPlan(p, z);
    expect(r.problems.join(" ")).toMatch(/point at the culprit/);
    expect(r.problems.join(" ")).toMatch(/Nothing clears Agnes Pell/);
  });

  it("flags answers a puzzle can't hide and answers that name a suspect", () => {
    const p = plan();
    p.chapters[0].clues[0] = { ...p.chapters[0].clues[0], kind: "crossword", answer: "TWO WORDS" };
    p.chapters[1].clues[0] = { ...p.chapters[1].clues[0], kind: "word-scramble", answer: "BRIGGS" };
    const r = checkMysteryPlan(p, z);
    expect(r.problems.join(" ")).toMatch(/one word/);
    expect(r.problems.join(" ")).toMatch(/names a suspect/);
  });

  it("requires a secret for every innocent suspect", () => {
    const p = plan();
    p.suspects[2].secret = "";
    expect(checkMysteryPlan(p, z).problems.join(" ")).toMatch(/Agnes Pell needs a secret/);
  });

  it("checks the timeline: no one in two places, alibis at the time of death, the culprit at the scene", () => {
    const p = plan();
    p.timeline.push({ time: "21:30", who: "Victor Lane", where: "the garden", doing: "walking" });
    p.timeline = p.timeline.filter((e) => !(e.who === "Thomas Briggs" && e.time === "00:00"));
    p.timeline.find((e) => e.who === "Agnes Pell" && e.time === "00:00")!.where = "the study";
    p.timeline = p.timeline.filter((e) => !(e.who === "Victor Lane" && e.where === "the study"));
    const all = checkMysteryPlan(p, z).problems.join(" ");
    expect(all).toMatch(/Victor Lane is in two places at 21:30/);
    expect(all).toMatch(/where is Thomas Briggs at 00:00/);
    expect(all).toMatch(/Agnes Pell is at the crime scene/);
    expect(all).toMatch(/culprit, Victor Lane, must be at the study/);
  });

  it("keeps the first quarter's clues neutral", () => {
    const p = plan();
    p.chapters[0].clues[0] = { ...p.chapters[0].clues[0], suspect: "Victor Lane", effect: "implicates" };
    expect(checkMysteryPlan(p, z).problems.join(" ")).toMatch(/points at the culprit too early/);
  });

  it("needs a wrong theory that holds through the middle", () => {
    const p = plan();
    p.falseTheory.suspect = "Victor Lane";
    expect(checkMysteryPlan(p, z).problems.join(" ")).toMatch(/falseTheory must name an innocent suspect/);
    const q = plan();
    // Clear the wrong suspect in chapter 2 instead of after the halfway point.
    const ledger = q.chapters[4].clues.splice(0, 1)[0];
    q.chapters[1].clues.push(ledger);
    expect(checkMysteryPlan(q, z).problems.join(" ")).toMatch(/should come after the halfway point/);
  });

  it("needs every puzzle to come from something in the story", () => {
    const p = plan();
    p.chapters[3].clues[0].source = "";
    expect(checkMysteryPlan(p, z).problems.join(" ")).toMatch(/needs a source/);
  });

  it("checks the final proof can be spelled from the clues, and spells it", () => {
    const p = plan();
    p.finalProof.answer = "JUKEBOX";
    expect(checkMysteryPlan(p, z).problems.join(" ")).toMatch(/can't be spelled from the clues/);
    const answers = ["CHECK THE DECANTER", "WINDOW", "BOOTS", "LEDGER"];
    const picks = deductionPicks(answers, "BENCH")!;
    expect(picks.map((x) => normalizeWord(answers[x.clue - 1])[x.letter - 1]).join("")).toBe("BENCH");
    expect(deductionPicks(answers, "QUIZ")).toBeNull();
  });

  it("judges a test reader: too easy early, or unsolvable at the end", () => {
    expect(judgeTest([{ checkpoint: "25%", suspect: "Victor Lane", confidence: 5, reasoning: "Only he had a reason." }], "Victor Lane").join(" ")).toMatch(/at 25%/);
    expect(judgeTest([{ checkpoint: "25%", suspect: "Victor Lane", confidence: 2, reasoning: "A hunch." }], "Victor Lane")).toEqual([]);
    expect(judgeTest([{ checkpoint: "100%", suspect: "Agnes Pell", confidence: 4, reasoning: "The will." }], "Victor Lane").join(" ")).toMatch(/accused Agnes Pell/);
    // The test sees the clues found by each checkpoint, never who is guilty.
    const cps = testCheckpoints(plan());
    expect(cps.map((c) => c.label)).toEqual(["25%", "50%", "75%", "100%"]);
    expect(cps[0].clues.length).toBeLessThan(cps[3].clues.length);
    expect(JSON.stringify(cps)).not.toMatch(/implicates|clears/);
  });

  it("sends the plan back when the test reader solves it too soon", async () => {
    const asked: string[] = [];
    let plans = 0;
    const eager: MysteryAsk = async (task, input, outputs) => {
      asked.push(task);
      if (task === "mystery-plan") plans++;
      if (task === "mystery-test") return { output: { verdicts: [{ checkpoint: "25%", suspect: plans < 2 ? "Victor Lane" : "unsure", confidence: plans < 2 ? 5 : 1, reasoning: "The clues point at him at once." }, { checkpoint: "100%", suspect: "Victor Lane", confidence: 5, reasoning: "All of it." }] } as never };
      return offlineAsk(task, input, outputs);
    };
    const r = await planMystery(eager, z, base);
    expect(asked).toEqual(["mystery-plan", "mystery-test", "mystery-plan", "mystery-test"]);
    expect(r.problems).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/revised plan passed the test/);
  });

  it("re-plans once with the problems, and falls back to a built-in case when the plan can't be built", async () => {
    const asked: unknown[] = [];
    const bad: MysteryAsk = async (task, input, outputs) => {
      asked.push(input);
      if (task === "mystery-plan") return { output: { ...plan(), culprit: "Nobody" } as never };
      return offlineAsk(task, input, outputs);
    };
    const r = await planMystery(bad, z, base);
    expect(asked).toHaveLength(2);
    expect((asked[1] as { problems?: string[] }).problems?.join(" ")).toMatch(/not one of the suspects/);
    expect(r.plan.culprit).toBe(BUILT_IN_CASES[0].plan.culprit);
    expect(r.notes.join(" ")).toMatch(/built-in case/);
  });
});

describe("clue puzzles", () => {
  it("hides a word search's message in its leftover letters, spread over the grid", () => {
    const ws = generateWordSearch(["CANDLE", "NAPKIN", "SILVER", "GOBLET", "PLATTER", "SOUP", "LADLE", "TUREEN"], 12, "medium", 42, undefined, "CHECK THE DECANTER");
    expect(ws.message).toBe("CHECKTHEDECANTER");
    expect(ws.placed).toHaveLength(8);
    const step = ws.messageStep!;
    expect(step).toBeGreaterThan(1);
    const left = leftoverLetters(ws);
    expect(Array.from({ length: 16 }, (_, k) => left[(k + 1) * step - 1]).join("")).toBe("CHECKTHEDECANTER");
    // Not in plain sight: no row reads the message's first word.
    expect(ws.grid.some((row) => row.join("").includes("CHECK"))).toBe(false);
  });

  it("orders scramble words so their shaded letters spell the secret", () => {
    const r = secretOrder(["LADLE", "KETTLE", "PUDDING", "GRAVY", "OVEN", "BREAD", "PANTRY"], "LEDGER")!;
    expect(r).not.toBeNull();
    expect(r.marks.map((m, k) => r.words[k][m]).join("")).toBe("LEDGER");
    expect(secretOrder(["CAT", "DOG"], "QUIZ")).toBeNull();
    // Bank words are added for letters the list lacks.
    expect(secretOrder(ensureSecret(["CAT", "DOG", "BIRD"], "ZEBRA"), "ZEBRA")).not.toBeNull();
  });

  it("always places a crossword's key answer", () => {
    const cfg: GeneratorConfig = { kind: "crossword", puzzles: [{ title: "The Study", entries: BUILT_IN_CASES[0].chapters[1].puzzles[0].entries, key: "WINDOW" }], size: 13, difficulty: "medium", solutions: true, seed: 7 };
    for (let seed = 1; seed < 15; seed++) expect(crosswordsOf({ ...cfg, seed })[0].cw.words.map((w) => w.answer)).toContain("WINDOW");
  });
});

describe("a whole mystery book", () => {
  it.each([
    ["8.5x11", 60, "country manor"],
    ["6x9", 80, "seaside hotel"],
    ["8.5x11", 48, "large print cozy mystery for seniors"],
  ] as const)("%s, %i pages (%s) builds, numbers its clues and passes preflight", async (trimId, pageTarget, topic) => {
    const i = { ...base, trimId, pageTarget, topic: `Murder mystery at a ${topic}`, audience: /seniors/.test(topic) ? "Seniors" : base.audience };
    const { book, project, planned } = await buildMystery(i);
    const pages = project.interior.pages;
    expect(pages.length).toBeGreaterThanOrEqual(pageTarget);
    expect(pages.length % 2).toBe(0);
    expect(pages.length).toBe(book.sections.reduce((n, s) => n + estimatePageCount("config" in s ? s.config : s), 0));

    // Every chapter is followed by its clue puzzles, numbered 1, 2, 3... through the book.
    const clueCount = planned.plan.chapters.reduce((n, c) => n + c.clues.length, 0);
    const puzzleLabels = project.interior.sections.filter((s) => /^Puzzle \d+/.test(s.label)).map((s) => Number(s.label.match(/^Puzzle (\d+)/)![1]));
    expect(puzzleLabels).toEqual(Array.from({ length: clueCount }, (_, k) => k + 1));
    expect(project.interior.sections.filter((s) => s.config.kind === "story")).toHaveLength(planned.plan.chapters.length + 1);

    // Each clue shows up in the answer key, so a stuck reader can check it.
    const key = texts(project, /^Answers:/).join(" ");
    for (const cl of planned.plan.chapters.flatMap((c) => c.clues).filter((c) => c.kind !== "cryptogram")) expect(key).toContain(cl.kind === "word-search" ? cl.answer : normalizeWord(cl.answer));

    // Puzzle pages carry a Case clue box, and the solution sits after the answer key.
    const labels = project.interior.sections.map((s) => s.label);
    expect(labels.indexOf("The solution")).toBeGreaterThan(labels.indexOf("Answer key"));
    expect(texts(project, /^Puzzle /).filter((t) => t === "CASE CLUE").length).toBe(planned.plan.chapters.flatMap((c) => c.clues).filter((c) => c.kind !== "cryptogram").length);

    // The contents list every chapter.
    const toc = project.interior.sections.find((s) => s.config.kind === "table-of-contents")!.config;
    expect(toc.kind === "table-of-contents" && toc.entries.length).toBe(planned.plan.chapters.length + 7);

    // The case board sits after the wrong theory is raised and before it is cleared, and names no culprit.
    const chapterAt = (effect: string) => labels.findIndex((l) => l.startsWith(`Chapter ${planned.plan.chapters.findIndex((ch) => ch.clues.some((cl) => cl.suspect === planned.plan.falseTheory.suspect && cl.effect === effect)) + 1}:`));
    expect(labels.indexOf("Case board")).toBeGreaterThan(chapterAt("implicates"));
    expect(labels.indexOf("Case board")).toBeLessThan(chapterAt("clears"));
    expect(texts(project, /^Case board$/).join(" ")).not.toContain(planned.plan.culprit);

    // Each chapter names its puzzles' exhibits: the things in the story they come from.
    const firstSource = planned.plan.chapters[0].clues[0].source;
    expect(texts(project, /^Chapter 1:/).join(" ")).toContain("Exhibit 1:");
    expect(texts(project, /^Chapter 1:/).join(" ")).toContain(firstSource.split(" ").slice(0, 3).join(" "));

    // The final deduction comes after the last chapter, and its picks spell the proof from the printed clue answers.
    const deduction = project.interior.sections.find((s) => s.label === "Final deduction")!.config;
    expect(deduction.kind).toBe("deduction");
    if (deduction.kind === "deduction") {
      const answers = planned.plan.chapters.flatMap((c) => c.clues.map((cl) => normalizeWord(cl.answer)));
      expect(deduction.picks.map((p) => answers[p.clue - 1][p.letter - 1]).join("")).toBe(planned.plan.finalProof.answer);
    }
    expect(labels.indexOf("Final deduction")).toBeLessThan(labels.indexOf("The accusation"));
    expect(labels).toContain("Answers: final deduction");

    // No spoilers in the listing summary.
    expect(book.summary).not.toContain(planned.plan.culprit);

    const report = runPreflight(project);
    // The listing and AI disclosure are filled in by later autopilot steps.
    expect(report.checks.filter((c) => c.status === "fail" && c.id !== "metadata" && c.id !== "ai-disclosure").map((c) => c.title)).toEqual([]);
  });

  it("asks a chapter to name the last chapter's clue, for readers who skip puzzles", () => {
    const c = BUILT_IN_CASES[0];
    const z = mysterySizing(base);
    const story = { story: "Nothing about it at all. ".repeat(40), puzzles: [{ title: "Kitchen", words: c.chapters[4].puzzles[0].words, entries: [] }] };
    expect(checkChapter(story, c.plan.chapters[4].clues, z, 300, c.plan.chapters[3].clues).problems.join(" ")).toMatch(/"CODICIL" plainly/);
    // The built-in cases do it in every chapter.
    for (const m of BUILT_IN_CASES)
      m.plan.chapters.slice(1).forEach((ch, k) => {
        const r = checkChapter(m.chapters[k + 1], ch.clues, z, 250, m.plan.chapters[k].clues);
        expect(r.problems.filter((x) => /plainly/.test(x)), `${m.plan.caseTitle} chapter ${k + 2}`).toEqual([]);
      });
  });

  it("fits each chapter's story on its pages", async () => {
    const { project } = await buildMystery({ ...base, trimId: "6x9", pageTarget: 64 });
    for (const sec of project.interior.sections.filter((s) => s.config.kind === "story")) {
      if (sec.config.kind !== "story") continue;
      const pages = generatePages(sec.config, { spec: project.spec, pageCountHint: project.interior.pages.length });
      expect(pages).toHaveLength(sec.config.pages);
      const words = pages.flatMap((p) => p.elements.filter((e): e is TextElement => e.type === "text" && e.name === "Story")).map((e) => e.text).join(" ").split(/\s+/).filter(Boolean).length;
      expect(words).toBe(sec.config.body.split(/\s+/).filter(Boolean).length);
    }
  });
});

describe("the story layer", () => {
  const z = mysterySizing(base);
  const plan = (): MysteryPlanOutput => structuredClone(BUILT_IN_CASES[0].plan);

  it.each(BUILT_IN_CASES.map((c) => [c.plan.caseTitle, c] as const))("built-in case %s has a full story bible", (_, c) => {
    expect(storyBibleProblems(c.plan)).toEqual([]);
    const file = caseFile(c.plan);
    expect(file).toContain("Story bible");
    expect(file).toContain(c.plan.suspects[0].tell);
    expect(file).toContain(c.plan.chapters[0].beats.cliffhanger);
  });

  it("asks for a missing bible without failing the plan", () => {
    const p = plan();
    p.bible = { voice: "", sleuth: "", locations: [], motifs: [] };
    p.suspects[0].voice = "";
    p.chapters[2].beats = { hook: "", turn: "", cliffhanger: "" };
    const r = checkMysteryPlan(p, z);
    expect(r.fatal).toBe(false);
    expect(r.problems.join(" ")).toMatch(/narrative voice/);
    expect(r.problems.join(" ")).toMatch(/3-6 locations/);
    expect(r.problems.join(" ")).toMatch(new RegExp(`Give ${p.suspects[0].name} a voice`));
    expect(r.problems.join(" ")).toMatch(/Chapter 3 needs beats/);
  });

  it("writes chapters in waves, each told what the earlier waves wrote", async () => {
    const seen: { chapter: number; earlier: string[]; previousEnding: string; openings: number }[] = [];
    const ask: MysteryAsk = async (task, input) => {
      if (task === "mystery-chapter") {
        const i = input as ReturnType<typeof chapterRequest>;
        if (!i.reveal) seen.push({ chapter: i.chapter, earlier: i.earlier, previousEnding: i.previousEnding, openings: i.openings.length });
        const out = offlineTask("mystery-chapter", i);
        return { output: { ...out, recap: i.reveal ? "" : `RECAP ${i.chapter}` } as never };
      }
      return offlineAsk(task, input, []);
    };
    const p = plan();
    await writeMystery(ask, p, z, base.audience, serial, 3);
    const by = (n: number) => seen.find((x) => x.chapter === n)!;
    // The first wave knows only the plan; later waves get the real recaps, the last chapter's ending and the openings so far.
    expect(by(2).earlier[0]).not.toContain("RECAP");
    expect(by(2).previousEnding).toBe("");
    expect(by(4).earlier.slice(0, 3).every((e, k) => e.includes(`RECAP ${k + 1}`))).toBe(true);
    expect(by(4).previousEnding).not.toBe("");
    expect(by(4).openings).toBe(3);
    expect(by(7).earlier[5]).toContain("RECAP 6");
  });

  it("rewrites at most a few chapters the story editor names, and keeps them only when no worse", async () => {
    const p = plan();
    const written = await writeMystery(offlineAsk, p, z, base.audience, serial);
    let rewrites = 0;
    const ask: MysteryAsk = async (task, input) => {
      if (task === "mystery-edit") return { output: { problems: [1, 2, 3, 4, 5, 6].map((chapter) => ({ chapter, problem: "Opens the same way as the chapter before." })) } as never };
      if (task === "mystery-chapter") {
        rewrites++;
        const out = offlineTask("mystery-chapter", input as ReturnType<typeof chapterRequest>);
        return { output: { ...out, story: `${out.story}\n\nA new last line.` } as never };
      }
      return offlineAsk(task, input, []);
    };
    const r = await editMystery(ask, p, written.chapters, z, base.audience, serial);
    expect(rewrites).toBe(MAX_EDITS);
    expect(r.edited).toEqual([0, 1, 2]);
    expect(r.chapters[0].story).toContain("A new last line.");
    expect(r.chapters[3]).toBe(written.chapters[3]);
    expect(r.notes.join(" ")).toMatch(/Story editor: rewrote chapters 1, 2, 3/);
    // An editor with nothing to say changes nothing.
    const quiet = await editMystery(offlineAsk, p, written.chapters, z, base.audience, serial);
    expect(quiet.chapters).toEqual(written.chapters);
  });
});
