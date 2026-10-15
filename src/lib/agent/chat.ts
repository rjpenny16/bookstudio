import type { ChatIntentOutput, ChatTarget, TaskInput } from "@/lib/ai/tasks";
import type { ChatMessage } from "@/lib/schema/project";
import { newId } from "@/lib/util/ids";

/**
 * The autopilot chat, minus the screen: what a message is about, which
 * stage of a running build can still use it, and the one short line each
 * finished stage is reported with. Pure, so the server (offline routing)
 * and tests can use it.
 */

/** The stages a direction sent mid-build can still change, in the order they run. */
export const DIRECTION_STAGES = ["plan", "content", "title", "listing", "cover"] as const;
export type DirectionStage = (typeof DIRECTION_STAGES)[number];

/** Messages kept on a project. */
export const CHAT_LIMIT = 100;

export const chatMessage = (role: ChatMessage["role"], text: string, tone?: ChatMessage["tone"]): ChatMessage => ({ id: newId("msg"), role, text, at: new Date().toISOString(), ...(tone ? { tone } : {}) });

/** The build stage a message's target feeds, or null when it isn't a change to the book. */
export function stageFor(target: ChatTarget): DirectionStage | null {
  switch (target) {
    case "plan":
      return "plan";
    case "content":
    case "chapter":
    case "section":
      return "content";
    case "title":
      return "title";
    case "listing":
      return "listing";
    case "cover":
      return "cover";
    default:
      return null;
  }
}

/** The step that has to start for a stage's direction to be used: plan, content (chapters), title, listing, art. */
export const STAGE_STEP: Record<DirectionStage, string> = { plan: "plan", content: "content", title: "title", listing: "listing", cover: "art" };

const STAGE_WORDS: Record<DirectionStage, string> = { plan: "planning the book", content: "writing the content", title: "naming the book", listing: "writing the listing", cover: "designing the cover" };

/** What the agent says when a direction arrives mid-build. */
export function ackLine(stage: DirectionStage, used: boolean): string {
  return used ? `Got it. I'll use that when I get to ${STAGE_WORDS[stage]}.` : `That part is already done, so I'll change it as soon as the draft is finished.`;
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];

/** Rule-based routing for offline mode (and a fallback when the model call fails). */
export function routeOffline(i: TaskInput<"chat-intent">): ChatIntentOutput {
  const m = i.message.trim();
  const lower = m.toLowerCase();
  const out = (target: ChatTarget, reply: string, extra: Partial<ChatIntentOutput> = {}): ChatIntentOutput => ({ target, chapter: 0, section: "", instruction: target === "question" ? "" : m, reply, ...extra });
  const num = lower.match(/\bchapter\s+(\d+|[a-z]+)\b/);
  if (num) {
    const n = /^\d+$/.test(num[1]) ? Number(num[1]) : NUMBER_WORDS.indexOf(num[1]);
    if (n > 0) return out("chapter", `I'll rewrite chapter ${n} with that in mind.`, { chapter: n });
  }
  const named = i.chapters.findIndex((t) => t.trim() && lower.includes(t.toLowerCase()));
  if (named >= 0) return out("chapter", `I'll rewrite "${i.chapters[named]}" with that in mind.`, { chapter: named + 1 });
  if (/\b(title|subtitle|name (?:of )?the book|call it|rename)\b/.test(lower)) return out("title", "I'll come up with titles that fit that.");
  if (/\b(cover|art|artwork|image|picture|colou?rs?|palette|font)\b/.test(lower)) return out("cover", "I'll change the cover to match.");
  if (/\b(listing|description|blurb|keywords?|categor(y|ies)|amazon|price)\b/.test(lower)) return out("listing", "I'll rewrite the listing with that in mind.");
  const section = i.sections.find((s) => s.trim().length > 2 && lower.includes(s.toLowerCase()));
  if (section) return out("section", `I'll redo "${section}" with that in mind.`, { section });
  if (/\b(suspects?|killer|culprit|victim|murder(er)?|setting|plot|twist|detective|sleuth|sections?|structure|difficulty|harder|easier)\b/.test(lower))
    return out(i.bookType === "mystery" || i.phase === "building" ? "plan" : "content", i.phase === "building" ? "I'll build that into the plan." : "I'll work that into the book.");
  if (/\?\s*$/.test(m) || /^(what|how|why|when|can|does|is|are|will)\b/.test(lower)) return out("question", "I can't answer questions offline, but tell me what to change and I'll do it.");
  return out("content", i.phase === "building" ? "Got it, I'll work that into the writing." : "I'll rework the writing with that in mind.");
}

/** The book idea from a first message: in "large print sudoku for seniors" the topic is "large print sudoku" and the reader "seniors". */
export function parseIdea(text: string): { topic: string; audience: string } {
  const t = text.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "");
  const m = t.match(/^(.*\S)\s+for\s+(.+)$/i);
  if (m && m[2].split(" ").length <= 8 && m[1].split(" ").length >= 2) return { topic: m[1], audience: m[2] };
  return { topic: t, audience: "" };
}

/**
 * The one line a finished step is reported with in the chat, or null for
 * steps worth no line of their own (they still show in Details).
 */
export function stepLine(id: string, detail = ""): string | null {
  const d = detail.trim();
  switch (id) {
    case "brief":
      return "I've worked out who the book is for and what it should do.";
    case "plan":
      return d ? `Planned: ${d}.` : "The plan is ready.";
    case "content":
      return d ? `Written: ${d}.` : "The writing is done.";
    case "check":
      return d ? `Checked: ${d}.` : null;
    case "layout":
      return d ? `Laid out: ${d}.` : null;
    case "title":
      return d ? `Named it ${d}.` : null;
    case "cover":
      return "The cover is designed.";
    case "preflight":
      return d ? `KDP checks: ${d}.` : null;
    default:
      return null;
  }
}
