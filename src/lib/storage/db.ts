"use client";

import { createStore, del, get, set, type UseStore } from "idb-keyval";
import { migrateProject } from "@/lib/schema/migrate";
import type { Project } from "@/lib/schema/project";

export interface ProjectSummary {
  id: string;
  name: string;
  bookType: Project["bookType"];
  trimId: string;
  pages: number;
  updatedAt: string;
  title: string;
}

let store: UseStore | null = null;
const db = () => (store ??= createStore("bookstudio", "kv"));

export function summarize(p: Project): ProjectSummary {
  return { id: p.id, name: p.name, bookType: p.bookType, trimId: p.spec.trimId, pages: p.interior.pages.length, updatedAt: p.updatedAt, title: p.metadata.title };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const index = (await get<ProjectSummary[]>("projects:index", db())) ?? [];
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
}

export async function deleteProject(id: string): Promise<void> {
  await del(`project:${id}`, db());
  const index = ((await get<ProjectSummary[]>("projects:index", db())) ?? []).filter((s) => s.id !== id);
  await set("projects:index", index, db());
}

export async function getValue<T>(key: string): Promise<T | undefined> {
  return get<T>(key, db());
}

export async function setValue<T>(key: string, value: T): Promise<void> {
  await set(key, value, db());
}
