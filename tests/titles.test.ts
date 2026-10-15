import { describe, expect, it, vi } from "vitest";

// Cover design renders in the browser; here the cover is left as it is so the title swap itself can be checked.
vi.mock("@/lib/cover/artClient", () => ({ designCover: async (p: unknown) => p }));

import { BUILT_IN_CASES } from "@/lib/agent/mystery";
import { applyTitle } from "@/lib/agent/regenerateClient";
import { checkTitleIdeas, mysteryAvoid, mysteryContents, titleRequest } from "@/lib/agent/titles";
import { offlineTask } from "@/lib/ai/offline";
import { TASKS, type TitleIdeasOutput } from "@/lib/ai/tasks";
import { createProject } from "@/lib/schema/factory";
import type { TextElement } from "@/lib/schema/project";

const idea = (title: string, extra: Partial<TitleIdeasOutput["ideas"][number]> = {}) => ({ title, subtitle: "A Murder Mystery Puzzle Book for Adults", hero: "", why: "Fits.", ...extra });

describe("checking title ideas", () => {
  it("drops spoilers, prohibited words, long titles and repeats", () => {
    const out: TitleIdeasOutput = {
      ideas: [
        idea("The Forged Landscape"),
        idea("Victor Lane Did It"),
        idea("The Suitcase in the Library"),
        idea("The #1 Bestseller Mystery"),
        idea("A Title So Long That It Runs Well Past The Sixty Character Limit Of Covers"),
        idea("the forged landscape!"),
        idea("Rain at Ravenscroft", { subtitle: "Who hid it in the suitcase?" }),
      ],
      pick: 1,
    };
    const r = checkTitleIdeas(out, ["Victor", "Lane", "SUITCASE"]);
    expect(r.ideas.map((x) => x.title)).toEqual(["The Forged Landscape"]);
    expect(r.dropped.join(" ")).toMatch(/Victor Lane Did It.*ending away/);
    expect(r.dropped.join(" ")).toMatch(/Rain at Ravenscroft.*ending away/);
    expect(r.dropped.join(" ")).toMatch(/over 60 characters/);
    expect(r.dropped.join(" ")).toMatch(/a repeat/);
  });

  it("puts the pick first, and falls back to the first survivor when the pick is dropped", () => {
    const ideas = [idea("Death at the Manor"), idea("The Stopped Clock", { hero: "Clock" }), idea("Murder in the Study")];
    expect(checkTitleIdeas({ ideas, pick: 2 }, []).ideas.map((x) => x.title)).toEqual(["The Stopped Clock", "Death at the Manor", "Murder in the Study"]);
    expect(checkTitleIdeas({ ideas, pick: 2 }, ["clock"]).ideas[0].title).toBe("Death at the Manor");
    // A hero that isn't in its title is dropped.
    expect(checkTitleIdeas({ ideas: [idea("Rainy Night", { hero: "Sudoku" })], pick: 1 }, []).ideas[0].hero).toBe("");
  });
});

describe("naming a mystery from its content", () => {
  it.each(BUILT_IN_CASES.map((c) => [c.plan.caseTitle, c] as const))("%s: offline ideas never give the ending away", (_, c) => {
    const avoid = mysteryAvoid(c.plan);
    expect(avoid).toContain(c.plan.finalProof.answer);
    expect(avoid.some((w) => c.plan.culprit.includes(w))).toBe(true);
    const contents = mysteryContents(c.plan);
    expect(contents).not.toContain(c.plan.solution);
    const input = titleRequest({ bookType: "mystery", topic: "murder mystery", audience: "adults", angle: "", keywordIdeas: [], contents, avoid, provisional: "Mystery Book" });
    const out = offlineTask("title-ideas", input);
    TASKS["title-ideas"].output.parse(out);
    const checked = checkTitleIdeas(out, avoid);
    expect(checked.ideas.length).toBeGreaterThanOrEqual(3);
    expect(checked.ideas[0].title).toBe(c.plan.caseTitle);
    for (const t of checked.ideas) for (const w of avoid) expect(t.title.toLowerCase()).not.toContain(w.toLowerCase());
  });
});

describe("swapping a title", () => {
  it("updates the listing, the title page and the stored order", async () => {
    let p = createProject({ name: "Old", bookType: "mystery", trimId: "6x9", paper: "white", ink: "black", bleed: false, author: "Ada Writer", interior: [{ label: "Title page", role: "front", config: { kind: "title-page", title: "Old", subtitle: "Old sub", author: "Ada Writer" } }] });
    const options = [idea("Death at Ravenscroft Manor"), idea("The Stopped Clock", { hero: "Clock", subtitle: "A Cozy Whodunit Puzzle Book" })];
    p = { ...p, metadata: { ...p.metadata, title: "Death at Ravenscroft Manor" }, brief: { ...p.brief, titleOptions: options } };
    const r = await applyTitle(p, options[1]);
    expect(r.project.metadata.title).toBe("The Stopped Clock");
    expect(r.project.metadata.subtitle).toBe("A Cozy Whodunit Puzzle Book");
    expect(r.project.name).toBe("The Stopped Clock");
    expect(r.project.brief.titleHero).toBe("Clock");
    expect(r.project.brief.titleOptions!.map((o) => o.title)).toEqual(["The Stopped Clock", "Death at Ravenscroft Manor"]);
    const text = r.project.interior.pages[0].elements.filter((e): e is TextElement => e.type === "text").map((e) => e.text).join(" ");
    expect(text).toContain("The Stopped Clock");
  });
});
