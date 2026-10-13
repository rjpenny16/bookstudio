"use client";

import type { LibraryArt, LibraryArtSummary } from "@/lib/cover/artLibrary";
import { genreOfProject } from "@/lib/cover/genres";
import type { CoverArtCandidate, ModelRun, Project } from "@/lib/schema/project";
import { deleteValue, getValue, setValue } from "./db";

/**
 * Every generated cover image lives in the browser next to projects, shared
 * by all of them: an index of summaries with small thumbnails, and each full
 * image under its own key so listing stays cheap.
 */
const INDEX = "artlib:index";
const key = (id: string) => `artlib:${id}`;

type Stored = { dataUrl: string; run?: ModelRun };

// Index updates are read-modify-write, so they run one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

const readIndex = async () => (await getValue<LibraryArtSummary[]>(INDEX)) ?? [];

export async function listLibrary(): Promise<LibraryArtSummary[]> {
  return (await readIndex()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadLibraryArt(id: string): Promise<LibraryArt | undefined> {
  const summary = (await readIndex()).find((e) => e.id === id);
  const stored = await getValue<Stored>(key(id));
  return summary && stored ? { ...summary, ...stored } : undefined;
}

function thumbnail(dataUrl: string, width = 240): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = Math.max(1, Math.round((width * img.naturalHeight) / img.naturalWidth));
      const ctx = c.getContext("2d");
      if (!ctx) return resolve("");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

/** Add generated images to the library; ones already there are skipped. Returns how many were added. */
export function archiveCandidates(project: Project, candidates: CoverArtCandidate[], runs: ModelRun[] = []): Promise<number> {
  return serial(async () => {
    const index = await readIndex();
    const have = new Set(index.map((e) => e.id));
    const fresh = candidates.filter((c) => !have.has(c.id));
    if (!fresh.length) return 0;
    const genre = genreOfProject(project).id;
    const chosen = project.coverArt?.chosenId;
    for (const c of fresh) {
      const { dataUrl, ...rest } = c;
      const run = runs.find((r) => r.id === c.runId);
      await setValue<Stored>(key(c.id), run ? { dataUrl, run } : { dataUrl });
      index.push({ ...rest, thumbUrl: await thumbnail(dataUrl), projectId: project.id, projectTitle: project.metadata.title || project.name, genre, used: c.id === chosen, favorite: false });
    }
    await setValue(INDEX, index);
    return fresh.length;
  });
}

/** Archive in the background: a storage failure (private window, full disk) never stops generation. */
export function keepInLibrary(project: Project, candidates: CoverArtCandidate[], runs?: ModelRun[]): void {
  archiveCandidates(project, candidates, runs).catch((e) => console.warn("Could not save cover art to the library", e));
}

function patch(id: string, change: Partial<Pick<LibraryArtSummary, "used" | "favorite">>): Promise<void> {
  return serial(async () => {
    const index = await readIndex();
    const i = index.findIndex((e) => e.id === id);
    if (i < 0 || Object.entries(change).every(([k, v]) => index[i][k as keyof typeof change] === v)) return;
    index[i] = { ...index[i], ...change };
    await setValue(INDEX, index);
  });
}

export const markLibraryArtUsed = (id: string) => patch(id, { used: true });
export const setLibraryFavorite = (id: string, favorite: boolean) => patch(id, { favorite });

export function deleteLibraryArt(id: string): Promise<void> {
  return serial(async () => {
    await setValue(
      INDEX,
      (await readIndex()).filter((e) => e.id !== id),
    );
    await deleteValue(key(id));
  });
}
