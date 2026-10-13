"use client";

import type { ModelRun } from "@/lib/schema/project";
import { newId } from "@/lib/util/ids";
import type { ProviderLimits } from "./limits";
import type { TaskInput, TaskName, TaskOutput } from "./tasks";

export interface AiCallResult<T extends TaskName> {
  output: TaskOutput<T>;
  meta: { provider: string; model: string; task: T; promptHash: string; ms?: number };
}

export interface AiStatus {
  provider: "anthropic" | "ollama" | "codex" | "offline";
  model: string;
  configured: boolean;
  detail: string;
  limits: ProviderLimits;
}

export async function aiStatus(): Promise<AiStatus> {
  const res = await fetch("/api/ai");
  return res.json();
}

/** An image for a vision task: base64 without the data: prefix. */
export interface AiImage {
  label: string;
  mediaType: "image/png" | "image/jpeg";
  data: string;
}

/** A failed AI request, with the HTTP status the server gave it (401 not logged in, 429 usage limit, 504 timeout…). */
export class AiCallError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AiCallError";
  }
}

/**
 * Run a task on the server. `offline` asks for the built-in heuristics instead
 * of the configured model (used to fill a section the model left short).
 */
export async function callAi<T extends TaskName>(task: T, input: TaskInput<T>, signal?: AbortSignal, images?: AiImage[], opts: { offline?: boolean } = {}): Promise<AiCallResult<T>> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task, input, ...(images?.length ? { images } : {}), ...(opts.offline ? { offline: true } : {}) }),
    signal,
  });
  const body = await res.json().catch(() => ({ error: `AI request failed (${res.status})` }));
  if (!res.ok) throw new AiCallError(body.error ?? `AI request failed (${res.status})`, res.status);
  return body as AiCallResult<T>;
}

/** Offline heuristics are deterministic templates, not AI; only real model output is AI-generated. */
export function isModelOutput(meta: { provider: string }): boolean {
  return meta.provider !== "offline";
}

export function modelRun(meta: AiCallResult<TaskName>["meta"], outputs: string[]): ModelRun {
  return { id: newId("run"), at: new Date().toISOString(), provider: meta.provider, model: meta.model, task: meta.task, promptHash: meta.promptHash, outputs, ...(meta.ms !== undefined ? { ms: meta.ms } : {}) };
}
