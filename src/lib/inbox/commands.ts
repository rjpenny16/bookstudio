import type { InboxItem } from "./state";

/** What a message in the ideas channel asks for. Kept apart from discord.js so it can be tested. */
export type Command = { kind: "ignore" } | { kind: "help" } | { kind: "status" } | { kind: "cancel"; n: number } | { kind: "idea"; text: string };

export interface IncomingMessage {
  authorId: string;
  channelId: string;
  isBot: boolean;
  content: string;
}

export interface BotConfig {
  ownerId: string;
  channelId: string;
}

export const HELP = [
  "Send a book idea and I'll build a full draft for you to review in BookStudio. For example:",
  "`large print sudoku for seniors, 120 pages`",
  "`gratitude journal for nurses 6x9`",
  "`word search for kids, letter size, no art`",
  "Lines after the first go to the brief as notes. Other commands: `status`, `cancel 2`, `help`.",
].join("\n");

/** Only the owner's messages in the ideas channel count; everything else is ignored. */
export function decide(msg: IncomingMessage, cfg: BotConfig): Command {
  if (msg.isBot || msg.channelId !== cfg.channelId || msg.authorId !== cfg.ownerId) return { kind: "ignore" };
  const text = msg.content.trim();
  if (!text) return { kind: "ignore" };
  const word = text.toLowerCase();
  if (word === "help" || word === "?") return { kind: "help" };
  if (word === "status" || word === "queue" || word === "list") return { kind: "status" };
  const cancel = word.match(/^(?:cancel|remove|delete)\s+#?(\d+)$/);
  if (cancel) return { kind: "cancel", n: Number(cancel[1]) };
  return { kind: "idea", text };
}

const ICON: Record<InboxItem["status"], string> = { queued: "📥", building: "🛠️", ready: "✅", failed: "⚠️" };

/** Ideas not yet built, in build order; `cancel n` counts in this list. */
export const pending = (items: InboxItem[]) => items.filter((i) => i.status === "queued" || i.status === "building");

export function statusText(items: InboxItem[]): string {
  const open = pending(items);
  const done = items.filter((i) => i.status === "ready" || i.status === "failed").slice(-5);
  if (!open.length && !done.length) return "The inbox is empty. Send a book idea to start one.";
  const lines: string[] = [];
  if (open.length) {
    lines.push("**Waiting**");
    open.forEach((i, n) => lines.push(`${n + 1}. ${ICON[i.status]} ${i.text.split("\n")[0]}`));
  }
  if (done.length) {
    lines.push("**Recent**");
    done.forEach((i) => lines.push(`${ICON[i.status]} ${i.result?.title ?? i.text.split("\n")[0]}${i.error ? ` (${i.error})` : ""}`));
  }
  return lines.join("\n");
}

export function readyText(item: InboxItem, url: string): string {
  const r = item.result!;
  const pf = `preflight ${r.preflight.passed}/${r.preflight.total}${r.preflight.blocking ? `, ${r.preflight.blocking} to fix` : ""}`;
  return `✅ Draft ready: **${r.title}**, ${r.pages} pages, ${pf}.\nReview & Publish on your computer: ${url}`;
}

/** Discord message ids are snowflakes: later messages have larger ids. */
export const snowflakeCompare = (a: string, b: string) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
