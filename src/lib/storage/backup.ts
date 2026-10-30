import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A copy of every project (and the research, sales and calibration data) on
 * the machine running BookStudio, in data/backup (or BACKUP_DIR), so clearing
 * the browser or switching browsers doesn't lose books. The browser stays the
 * working copy; this is the safety net. Deleted projects go to trash/, not away.
 */

export const backupDir = () => process.env.BACKUP_DIR || path.join(process.cwd(), "data", "backup");

/** Browser values that are user data worth keeping; anything else (caches) isn't backed up. */
export const BACKED_UP_VALUES = ["research:boards", "sales:rows", "sales:curve"] as const;
export type BackedUpValue = (typeof BACKED_UP_VALUES)[number];

export interface BackupSummary {
  id: string;
  title: string;
  updatedAt: string;
  bytes: number;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const isProjectId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
export const isBackedUpValue = (key: unknown): key is BackedUpValue => typeof key === "string" && (BACKED_UP_VALUES as readonly string[]).includes(key);

const projectsDir = () => path.join(backupDir(), "projects");
const projectFile = (id: string) => path.join(projectsDir(), `${id}.json`);
const valueFile = (key: BackedUpValue) => path.join(backupDir(), "values", `${key.replace(":", "-")}.json`);

async function atomicWrite(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/** Saves a project unless the copy already there is newer (another tab's later save wins). Returns whether it wrote. */
export async function backupProject(project: { id: string; updatedAt?: string }): Promise<boolean> {
  if (!isProjectId(project.id)) throw new Error("Not a project id");
  const prev = await readProjectBackup(project.id).catch(() => null);
  if (prev?.updatedAt && project.updatedAt && prev.updatedAt > project.updatedAt) return false;
  await atomicWrite(projectFile(project.id), JSON.stringify(project));
  return true;
}

export async function readProjectBackup(id: string): Promise<{ id: string; updatedAt?: string; [k: string]: unknown } | null> {
  if (!isProjectId(id)) return null;
  try {
    return JSON.parse(await readFile(projectFile(id), "utf8"));
  } catch {
    return null;
  }
}

export async function listProjectBackups(): Promise<BackupSummary[]> {
  let names: string[];
  try {
    names = (await readdir(projectsDir())).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: BackupSummary[] = [];
  for (const name of names) {
    const file = path.join(projectsDir(), name);
    try {
      const p = JSON.parse(await readFile(file, "utf8")) as { id: string; name?: string; updatedAt?: string; metadata?: { title?: string } };
      out.push({ id: p.id, title: p.metadata?.title || p.name || p.id, updatedAt: p.updatedAt ?? "", bytes: (await stat(file)).size });
    } catch {
      // A half-written or foreign file: skip it rather than fail the list.
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Moves a deleted project's copy to trash/ so a mistaken delete can still be undone by hand. */
export async function trashProjectBackup(id: string): Promise<void> {
  if (!isProjectId(id)) return;
  const trash = path.join(backupDir(), "trash");
  await mkdir(trash, { recursive: true });
  await rename(projectFile(id), path.join(trash, `${id}.${Date.now()}.json`)).catch(() => undefined);
}

export async function backupValue(key: BackedUpValue, value: unknown): Promise<void> {
  await atomicWrite(valueFile(key), JSON.stringify({ savedAt: new Date().toISOString(), value }));
}

export async function readValueBackups(): Promise<Partial<Record<BackedUpValue, { savedAt: string; value: unknown }>>> {
  const out: Partial<Record<BackedUpValue, { savedAt: string; value: unknown }>> = {};
  for (const key of BACKED_UP_VALUES) {
    try {
      out[key] = JSON.parse(await readFile(valueFile(key), "utf8"));
    } catch {
      // Not backed up yet.
    }
  }
  return out;
}
