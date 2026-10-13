import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decide, pending, readyText, snowflakeCompare, statusText } from "@/lib/inbox/commands";
import { describeIdea, parseIdea } from "@/lib/inbox/parse";
import { addItem, claimNext, emptyState, removeItem, requeueStale, STALE_MS, updateItem, type InboxState } from "@/lib/inbox/state";
import { mutateInbox, readInbox } from "@/lib/inbox/store";
import { inferSetup } from "@/lib/agent/setup";

describe("parseIdea", () => {
  it("splits the book from its reader and reads pages", () => {
    const p = parseIdea("large print sudoku for seniors, 120 pages");
    expect(p).toMatchObject({ topic: "large print sudoku", audience: "seniors", pageTarget: 120, coverArt: true });
    expect(inferSetup(p.topic, p.audience)).toMatchObject({ bookType: "puzzle", trimId: "8.5x11" });
  });

  it("reads trim sizes, letter size and no art", () => {
    expect(parseIdea("gratitude journal for nurses 6x9")).toMatchObject({ topic: "gratitude journal", audience: "nurses", trimId: "6x9" });
    expect(parseIdea('word search for kids, 8.5" x 11", no art')).toMatchObject({ topic: "word search", audience: "kids", trimId: "8.5x11", coverArt: false });
    expect(parseIdea("word search for kids, letter size")).toMatchObject({ audience: "kids", trimId: "8.5x11" });
  });

  it("ignores sizes and page counts KDP or autopilot can't use", () => {
    const p = parseIdea("mileage log 4x4, 900 pages");
    expect(p.trimId).toBeUndefined();
    expect(p.pageTarget).toBeUndefined();
    expect(p.topic).toBe("mileage log");
  });

  it("keeps later lines as notes and works without an audience", () => {
    const p = parseIdea("Dot grid notebook\nminimal cover\nsage green");
    expect(p).toMatchObject({ topic: "Dot grid notebook", audience: "", notes: "minimal cover\nsage green" });
    expect(describeIdea(parseIdea("sudoku for seniors 100 pages no art"))).toBe("sudoku for seniors, 100 pages, no cover art");
  });
});

describe("decide", () => {
  const cfg = { ownerId: "1", channelId: "c" };
  const msg = (content: string, over: Partial<{ authorId: string; channelId: string; isBot: boolean }> = {}) => ({ authorId: "1", channelId: "c", isBot: false, content, ...over });

  it("only listens to the owner in the ideas channel", () => {
    expect(decide(msg("sudoku"), cfg)).toEqual({ kind: "idea", text: "sudoku" });
    expect(decide(msg("sudoku", { authorId: "2" }), cfg).kind).toBe("ignore");
    expect(decide(msg("sudoku", { channelId: "d" }), cfg).kind).toBe("ignore");
    expect(decide(msg("sudoku", { isBot: true }), cfg).kind).toBe("ignore");
    expect(decide(msg("   "), cfg).kind).toBe("ignore");
  });

  it("knows the commands", () => {
    expect(decide(msg("Status"), cfg).kind).toBe("status");
    expect(decide(msg("help"), cfg).kind).toBe("help");
    expect(decide(msg("cancel #2"), cfg)).toEqual({ kind: "cancel", n: 2 });
    expect(decide(msg("cancel my sudoku idea"), cfg).kind).toBe("idea");
  });

  it("orders snowflakes numerically", () => {
    expect(snowflakeCompare("999", "1000")).toBe(-1);
    expect(snowflakeCompare("1300000000000000001", "1300000000000000000")).toBe(1);
  });
});

describe("inbox state", () => {
  const t0 = new Date("2026-10-13T10:00:00Z");
  const idea = parseIdea("sudoku for seniors");
  const two = (): InboxState => {
    let s = addItem(emptyState(), { id: "a", messageId: "m1", text: "sudoku for seniors", idea }, t0);
    s = addItem(s, { id: "b", messageId: "m2", text: "maze for kids", idea: parseIdea("maze for kids") }, t0);
    return s;
  };

  it("doesn't queue the same message twice", () => {
    const s = two();
    expect(addItem(s, { id: "c", messageId: "m1", text: "x", idea }, t0)).toBe(s);
  });

  it("claims oldest first, one at a time", () => {
    const { state, item } = claimNext(two(), t0);
    expect(item?.id).toBe("a");
    expect(item?.status).toBe("building");
    const second = claimNext(state, t0);
    expect(second.item?.id).toBe("b");
    expect(claimNext(second.state, t0).item).toBeNull();
  });

  it("queues a build again when its tab stops checking in", () => {
    const { state } = claimNext(two(), t0);
    expect(requeueStale(state, new Date(t0.getTime() + STALE_MS - 1))).toBe(state);
    const beat = updateItem(state, "a", new Date(t0.getTime() + STALE_MS - 1000), { heartbeatAt: new Date(t0.getTime() + STALE_MS - 1000).toISOString() }).state;
    expect(requeueStale(beat, new Date(t0.getTime() + STALE_MS + 1)).items[0].status).toBe("building");
    const stale = requeueStale(state, new Date(t0.getTime() + STALE_MS + 1));
    expect(stale.items[0].status).toBe("queued");
  });

  it("describes the queue and a finished draft", () => {
    let s = claimNext(two(), t0).state;
    s = updateItem(s, "a", t0, { status: "ready", result: { projectId: "p1", title: "Sudoku for Seniors", pages: 120, preflight: { passed: 12, total: 12, blocking: 0 } } }).state;
    expect(pending(s.items).map((i) => i.id)).toEqual(["b"]);
    expect(statusText(s.items)).toContain("1. 📥 maze for kids");
    expect(statusText(s.items)).toContain("✅ Sudoku for Seniors");
    expect(readyText(s.items[0], "http://localhost:3000/projects/p1#review")).toContain("**Sudoku for Seniors**, 120 pages, preflight 12/12");
    expect(removeItem(s, "b").items).toHaveLength(1);
  });
});

describe("inbox file", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "inbox-"));
    process.env.INBOX_FILE = path.join(dir, "nested", "inbox.json");
  });
  afterAll(async () => {
    delete process.env.INBOX_FILE;
    await rm(dir, { recursive: true, force: true });
  });

  it("saves changes in order", async () => {
    expect((await readInbox()).items).toEqual([]);
    const now = new Date();
    await Promise.all(
      ["a", "b", "c"].map((id) => mutateInbox((s) => ({ state: addItem(s, { id, text: id, idea: parseIdea(id) }, now), result: null }))),
    );
    const saved = JSON.parse(await readFile(process.env.INBOX_FILE!, "utf8")) as InboxState;
    expect(saved.items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});
