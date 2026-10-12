"use client";

import type { ModelRun } from "@/lib/schema/project";
import { newId } from "@/lib/util/ids";
import type { TaskInput, TaskName, TaskOutput } from "./tasks";

export interface AiCallResult<T extends TaskName> {
  output: TaskOutput<T>;
  meta: { provider: string; model: string; task: T; promptHash: string };
}

export interface AiStatus {
  provider: "anthropic" | "ollama" | "codex" | "offline";
  model: string;
  configured: boolean;
  detail: string;
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

export async function callAi<T extends TaskName>(task: T, input: TaskInput<T>, signal?: AbortSignal, images?: AiImage[]): Promise<AiCallResult<T>> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(images?.length ? { task, input, images } : { task, input }),
    signal,
  });
  const body = await res.json().catch(() => ({ error: `AI request failed (${res.status})` }));
  if (!res.ok) throw new Error(body.error ?? `AI request failed (${res.status})`);
  return body as AiCallResult<T>;
}

/** Offline heuristics are deterministic templates, not AI; only real model output is AI-generated. */
export function isModelOutput(meta: { provider: string }): boolean {
  return meta.provider !== "offline";
}

export function modelRun(meta: AiCallResult<TaskName>["meta"], outputs: string[]): ModelRun {
  return { id: newId("run"), at: new Date().toISOString(), provider: meta.provider, model: meta.model, task: meta.task, promptHash: meta.promptHash, outputs };
}
