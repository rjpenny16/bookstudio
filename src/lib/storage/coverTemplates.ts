"use client";

import { parseCoverTemplate, type SavedCoverTemplate } from "@/lib/cover/library";
import { getValue, setValue } from "./db";

/** Saved cover templates live in the browser next to projects, shared by every project. */
const KEY = "cover-templates";

export async function listCoverTemplates(): Promise<SavedCoverTemplate[]> {
  const all = (await getValue<SavedCoverTemplate[]>(KEY)) ?? [];
  return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveCoverTemplate(t: SavedCoverTemplate): Promise<void> {
  const all = ((await getValue<SavedCoverTemplate[]>(KEY)) ?? []).filter((x) => x.id !== t.id);
  await setValue(KEY, [...all, t]);
}

export async function deleteCoverTemplate(id: string): Promise<void> {
  const all = (await getValue<SavedCoverTemplate[]>(KEY)) ?? [];
  await setValue(
    KEY,
    all.filter((t) => t.id !== id),
  );
}

export async function getCoverTemplate(id: string): Promise<SavedCoverTemplate | undefined> {
  return ((await getValue<SavedCoverTemplate[]>(KEY)) ?? []).find((t) => t.id === id);
}

/** Read a template file (from "Download") and keep it. Throws with a readable message. */
export async function importCoverTemplate(file: File): Promise<SavedCoverTemplate> {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    throw new Error("The file isn't valid JSON.");
  }
  const t = parseCoverTemplate(json);
  // Importing the same file twice keeps one copy.
  await saveCoverTemplate(t);
  return t;
}

export function downloadCoverTemplate(t: SavedCoverTemplate) {
  const blob = new Blob([JSON.stringify(t)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "cover-template"}.bookstudio-cover.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
