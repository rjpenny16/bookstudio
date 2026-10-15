import { describe, expect, it } from "vitest";
import { ackLine, parseIdea, routeOffline, stageFor, stepLine } from "@/lib/agent/chat";
import { assembleMystery, mysterySizing, mysteryStyle, planMystery, writeMystery, type MysteryAsk } from "@/lib/agent/mystery";
import { chapterSection, chapterStory, regenerateChapter } from "@/lib/agent/regenerate";
import { pool } from "@/lib/agent/content";
import { offlineTask } from "@/lib/ai/offline";
import { TASKS, type TaskInput } from "@/lib/ai/tasks";
import { createProject } from "@/lib/schema/factory";
import type { Project } from "@/lib/schema/project";

const route = (message: string, extra: Partial<TaskInput<"chat-intent">> = {}) => routeOffline({ message, phase: "done", bookType: "mystery", title: "Death at Ravenscroft Manor", chapters: ["A Birthday to Remember", "The Locked Study"], sections: ["Easy", "Hard"], ...extra });

describe("reading a chat message", () => {
  it("finds what a message is about", () => {
    expect(route("Make chapter 2 spookier")).toMatchObject({ target: "chapter", chapter: 2 });
    expect(route("rewrite chapter three please")).toMatchObject({ target: "chapter", chapter: 3 });
    expect(route("The locked study feels rushed")).toMatchObject({ target: "chapter", chapter: 2 });
    expect(route("I want a punchier title").target).toBe("title");
    expect(route("Use darker colors on the cover").target).toBe("cover");
    expect(route("The description should mention gifts").target).toBe("listing");
    expect(route("Make the Hard section tougher")).toMatchObject({ target: "section", section: "Hard" });
    expect(route("Make the victim a chef", { phase: "building" }).target).toBe("plan");
    expect(route("How long will this take?").target).toBe("question");
    expect(route("More humor please").target).toBe("content");
    // The schema the model's answer is held to accepts the offline answer too.
    TASKS["chat-intent"].output.parse(offlineTask("chat-intent", { message: "new title", phase: "done", bookType: "puzzle", title: "", chapters: [], sections: [] }));
  });

  it("sends each kind of change to the stage that can still use it", () => {
    expect(stageFor("chapter")).toBe("content");
    expect(stageFor("cover")).toBe("cover");
    expect(stageFor("question")).toBeNull();
    expect(ackLine("plan", true)).toMatch(/planning the book/);
    expect(ackLine("plan", false)).toMatch(/already done/);
  });

  it("splits a first message into the topic and the reader", () => {
    expect(parseIdea("large print sudoku for seniors")).toEqual({ topic: "large print sudoku", audience: "seniors" });
    expect(parseIdea("cozy murder mystery at a seaside hotel.")).toEqual({ topic: "cozy murder mystery at a seaside hotel", audience: "" });
    expect(stepLine("title", '"The Stopped Clock" (best of 5)')).toBe('Named it "The Stopped Clock" (best of 5).');
    expect(stepLine("art", "x")).toBeNull();
  });
});

describe("rewriting one chapter", () => {
  const offlineAsk: MysteryAsk = async (task, input) => ({ output: offlineTask(task, input) });
  const serial = <T, R>(items: T[], fn: (item: T, index: number) => Promise<R>) => pool(items, 2, fn);

  it("changes only the story, keeping its exhibits, clues and the case", async () => {
    const i = { topic: "Murder mystery at a country manor", audience: "Adults", notes: "", angle: "", title: "Death at the Manor", trimId: "6x9", pageTarget: 64, difficulty: "medium" as const };
    const z = mysterySizing(i);
    const plan = (await planMystery(offlineAsk, z, i)).plan;
    const written = await writeMystery(offlineAsk, plan, z, i.audience, serial);
    const book = assembleMystery(plan, written.chapters, written.reveal, z, { ...i, subtitle: "", author: "A" });
    const project = { ...createProject({ name: i.title, bookType: "mystery", trimId: i.trimId, paper: "white", ink: "black", bleed: false, author: "A", interior: book.sections, style: mysteryStyle(i) }), mystery: plan };
    let seen: TaskInput<"mystery-chapter"> | null = null;
    const ask: MysteryAsk = async (task, input) => {
      seen = input as TaskInput<"mystery-chapter">;
      return { output: { story: "Rain hammered the glass as Finch read the will again.\n\n".repeat(30).trim(), recap: "", puzzles: [] } as never };
    };
    const before = chapterSection(project, 3)!;
    const r = await regenerateChapter(project, plan, 3, "More rain, more dread", ask);
    expect(seen!.feedback).toBe("More rain, more dread");
    expect(seen!.chapter).toBe(3);
    // Earlier chapters' real text is passed on: the last lines of chapter 2.
    expect(seen!.previousEnding).not.toBe("");
    const after = chapterSection(r.project, 3)!;
    expect(after.config.kind === "story" && after.config.body).toMatch(/^Rain hammered the glass/);
    expect(after.config.kind === "story" && before.config.kind === "story" && chapterStory(after.config.body).lead).toBe(chapterStory(before.config.kind === "story" ? before.config.body : "").lead);
    // Every other section is untouched (the contents only move their page numbers), and the puzzles are the same.
    const others = (p: Project) => p.interior.sections.filter((s) => s.id !== before.id && s.config.kind !== "table-of-contents").map((s) => JSON.stringify(s.config));
    expect(others(r.project)).toEqual(others(project));
    expect(r.summary).toMatch(/Rewrote chapter 3/);
    await expect(regenerateChapter(project, plan, 3, "x", async () => ({ output: { story: "Too short.", recap: "", puzzles: [] } as never }))).rejects.toThrow(/too short/);
  });
});
