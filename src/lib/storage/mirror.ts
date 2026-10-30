"use client";

import type { Project } from "@/lib/schema/project";

/**
 * Sends a copy of each saved project (and the research and sales data) to the
 * BookStudio server's backup folder, a few seconds after the last change so a
 * burst of edits makes one request. A failed backup never blocks a save; the
 * last failure is kept for Settings to show.
 */

const DELAY_MS = 3000;
const BACKED_UP_VALUES = new Set(["research:boards", "sales:rows", "sales:curve"]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let lastError: { at: string; message: string } | null = null;
let lastSaved: string | null = null;

export const backupHealth = () => ({ lastError, lastSaved });

const inBrowser = () => typeof window !== "undefined" && typeof fetch === "function";

const sentAt = new Map<string, number>();

function sendNow(key: string, send: () => Promise<Response>) {
  sentAt.set(key, Date.now());
  send()
    .then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      lastSaved = new Date().toISOString();
      lastError = null;
    })
    .catch((e: unknown) => {
      lastError = { at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) };
    });
}

/** The first save goes at once; saves right after it wait until the edits pause, then go as one. */
function later(key: string, send: () => Promise<Response>) {
  if (!inBrowser()) return;
  clearTimeout(timers.get(key));
  if (!timers.has(key) && Date.now() - (sentAt.get(key) ?? 0) > DELAY_MS) {
    sendNow(key, send);
    return;
  }
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      sendNow(key, send);
    }, DELAY_MS),
  );
}

const post = (body: unknown) => fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function mirrorProject(p: Project) {
  later(`project:${p.id}`, () => post({ project: p }));
}

export function mirrorDelete(id: string) {
  if (!inBrowser()) return;
  clearTimeout(timers.get(`project:${id}`));
  void fetch(`/api/backup?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
}

export function mirrorValue(key: string, value: unknown) {
  if (BACKED_UP_VALUES.has(key)) later(key, () => post({ key, value }));
}

/** Asks the browser not to evict this site's storage when space runs low. */
export async function requestPersistence(): Promise<boolean | null> {
  if (!inBrowser() || !navigator.storage?.persist) return null;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}
