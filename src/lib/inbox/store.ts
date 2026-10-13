import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyState, type InboxItem, type InboxState } from "./state";

// No "server-only" import: the instrumentation bundle that starts the Discord bot loads this too.
/**
 * Keeps the inbox in a JSON file next to the app (data/inbox.json, or
 * INBOX_FILE). Projects still live in the browser; this file only holds ideas
 * and where their drafts ended up.
 */
export const inboxFile = () => process.env.INBOX_FILE || path.join(process.cwd(), "data", "inbox.json");

/** Shared across the route bundles and the instrumentation bundle, which load this module separately. */
export type InboxListener = (item: InboxItem, extra?: { coverPng?: Buffer }) => void;
interface InboxGlobal {
  queue: Promise<unknown>;
  listeners: Set<InboxListener>;
}
const g = globalThis as typeof globalThis & { __bookstudioInbox?: InboxGlobal };
const shared = (g.__bookstudioInbox ??= { queue: Promise.resolve(), listeners: new Set() });

async function read(): Promise<InboxState> {
  try {
    const s = JSON.parse(await readFile(inboxFile(), "utf8")) as InboxState;
    return Array.isArray(s.items) ? s : emptyState();
  } catch {
    return emptyState();
  }
}

async function write(s: InboxState) {
  const file = inboxFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, file);
}

/** Reads, changes and saves the inbox one change at a time. */
export function mutateInbox<R>(fn: (s: InboxState) => { state: InboxState; result: R }): Promise<R> {
  const run = shared.queue.then(async () => {
    const before = await read();
    const { state, result } = fn(before);
    if (state !== before) await write(state);
    return result;
  });
  shared.queue = run.catch(() => undefined);
  return run;
}

export const readInbox = () => mutateInbox((s) => ({ state: s, result: s }));

/** The Discord bot listens here to reply when a build starts, finishes or fails. */
export function onInboxChange(fn: InboxListener): () => void {
  shared.listeners.add(fn);
  return () => void shared.listeners.delete(fn);
}

export function notifyInboxChange(item: InboxItem, extra?: { coverPng?: Buffer }) {
  for (const fn of shared.listeners) {
    try {
      fn(item, extra);
    } catch (err) {
      console.error("Inbox listener failed", err);
    }
  }
}
