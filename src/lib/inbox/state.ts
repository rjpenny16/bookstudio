import type { ParsedIdea } from "./parse";

/**
 * The phone inbox: ideas sent from Discord wait here until an open BookStudio
 * tab builds them. Pure state transitions; `store.ts` keeps them in a file.
 */
export type InboxStatus = "queued" | "building" | "ready" | "failed";

export interface InboxResult {
  projectId: string;
  title: string;
  pages: number;
  preflight: { passed: number; total: number; blocking: number };
}

export interface InboxItem {
  id: string;
  /** Discord message the idea came from, so replies thread under it. */
  messageId?: string;
  channelId?: string;
  text: string;
  idea: ParsedIdea;
  status: InboxStatus;
  createdAt: string;
  updatedAt: string;
  /** Last sign of life from the tab building it. */
  heartbeatAt?: string;
  result?: InboxResult;
  error?: string;
}

export interface InboxState {
  items: InboxItem[];
  /** Newest Discord message handled, so ideas sent while the computer was off are caught up on start. */
  lastMessageId?: string;
}

/** A build with no heartbeat for this long is assumed lost (tab closed) and queued again. */
export const STALE_MS = 10 * 60_000;

export const emptyState = (): InboxState => ({ items: [] });

const touch = (it: InboxItem, now: Date, patch: Partial<InboxItem>): InboxItem => ({ ...it, ...patch, updatedAt: now.toISOString() });

export function addItem(s: InboxState, item: Omit<InboxItem, "status" | "createdAt" | "updatedAt">, now: Date): InboxState {
  if (item.messageId && s.items.some((i) => i.messageId === item.messageId)) return s;
  const at = now.toISOString();
  return { ...s, items: [...s.items, { ...item, status: "queued", createdAt: at, updatedAt: at }] };
}

export function requeueStale(s: InboxState, now: Date): InboxState {
  let changed = false;
  const items = s.items.map((it) => {
    if (it.status !== "building") return it;
    const last = Date.parse(it.heartbeatAt ?? it.updatedAt);
    if (now.getTime() - last < STALE_MS) return it;
    changed = true;
    return touch(it, now, { status: "queued", heartbeatAt: undefined });
  });
  return changed ? { ...s, items } : s;
}

/** Hands the oldest queued idea to a tab. */
export function claimNext(s: InboxState, now: Date): { state: InboxState; item: InboxItem | null } {
  const fresh = requeueStale(s, now);
  const next = fresh.items.find((i) => i.status === "queued");
  if (!next) return { state: fresh, item: null };
  const claimed = touch(next, now, { status: "building", heartbeatAt: now.toISOString(), error: undefined });
  return { state: { ...fresh, items: fresh.items.map((i) => (i.id === next.id ? claimed : i)) }, item: claimed };
}

export function updateItem(s: InboxState, id: string, now: Date, patch: Partial<Pick<InboxItem, "status" | "result" | "error" | "heartbeatAt">>): { state: InboxState; item: InboxItem | null } {
  const it = s.items.find((i) => i.id === id);
  if (!it) return { state: s, item: null };
  const next = touch(it, now, patch);
  return { state: { ...s, items: s.items.map((i) => (i.id === id ? next : i)) }, item: next };
}

export function removeItem(s: InboxState, id: string): InboxState {
  return { ...s, items: s.items.filter((i) => i.id !== id) };
}
