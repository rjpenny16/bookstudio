"use client";

import { createStore, del, get, set, type UseStore } from "idb-keyval";
import { migrateProject } from "@/lib/schema/migrate";
import { mirrorDelete, mirrorProject, mirrorValue } from "./mirror";
import type { FormatEdition, Project } from "@/lib/schema/project";

export interface ProjectSummary {
  id: string;
  name: string;
  bookType: Project["bookType"];
  trimId: string;
  pages: number;
  updatedAt: string;
  title: string;
  /** The published book's ASIN, when known (optional). */
  asin?: string;
  /** Each format's KDP status, for the weekly quota and planner (missing on summaries saved before schema 1.2). */
  editions?: Pick<FormatEdition, "kind" | "enabled" | "kdp">[];
}

let store: UseStore | null = null;
const db = () => (store ??= createStore("bookstudio", "kv"));

export function summarize(p: Project): ProjectSummary {
  return { id: p.id, name: p.name, bookType: p.bookType, trimId: p.spec.trimId, pages: p.interior.pages.length, updatedAt: p.updatedAt, title: p.metadata.title, ...(p.metadata.asin ? { asin: p.metadata.asin } : {}), editions: (p.formats ?? []).map((f) => ({ kind: f.kind, enabled: f.enabled, kdp: { ...f.kdp } })) };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  let index = (await get<ProjectSummary[]>("projects:index", db())) ?? [];
  // Summaries saved before formats existed: rebuild them once from the projects.
  if (index.some((s) => !s.editions)) {
    index = await Promise.all(index.map(async (s) => (s.editions ? s : ((p) => (p ? summarize(p) : s))(await loadProject(s.id)))));
    await set("projects:index", index, db());
  }
  return index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const p = await get<Project>(`project:${id}`, db());
  return p ? migrateProject(p) : undefined;
}

export async function saveProject(p: Project): Promise<void> {
  await set(`project:${p.id}`, p, db());
  const index = ((await get<ProjectSummary[]>("projects:index", db())) ?? []).filter((s) => s.id !== p.id);
  index.push(summarize(p));
  await set("projects:index", index, db());
  mirrorProject(p);
}

export async function deleteProject(id: string): Promise<void> {
  await del(`project:${id}`, db());
  const index = ((await get<ProjectSummary[]>("projects:index", db())) ?? []).filter((s) => s.id !== id);
  await set("projects:index", index, db());
  mirrorDelete(id);
}

export async function getValue<T>(key: string): Promise<T | undefined> {
  return get<T>(key, db());
}

export async function setValue<T>(key: string, value: T): Promise<void> {
  await set(key, value, db());
  mirrorValue(key, value);
}

export async function deleteValue(key: string): Promise<void> {
  await del(key, db());
  mirrorValue(key, null);
}
