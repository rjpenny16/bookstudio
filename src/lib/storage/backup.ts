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
export const BACKED_UP_VALUES = ["research:boards", "sales:rows", "sales:curve", "autoplan:settings"] as const;
export type BackedUpValue = (typeof BACKED_UP_VALUES)[number];

export interface BackupSummary {
  id: string;
  title: string;
  updatedAt: string;
  bytes: number;
}

/** A format's KDP status, kept in the index so the inbox's `quota` command needn't open projects. */
export interface BackupEdition {
  kind: "paperback" | "hardcover" | "ebook";
  enabled: boolean;
  kdp: { status: "not-started" | "planned" | "created" | "submitted" | "live"; plannedWeek?: string; createdAt?: string; submittedAt?: string };
}

/** One entry of the backup index: what listing needs, plus the file's size and time to spot outside changes. */
interface IndexEntry extends BackupSummary {
  /** Modification time; compared to within a millisecond (file systems and copies round it). */
  mtimeMs: number;
  editions?: BackupEdition[];
}
type BackupIndex = Record<string, IndexEntry>;

const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const isProjectId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
export const isBackedUpValue = (key: unknown): key is BackedUpValue => typeof key === "string" && (BACKED_UP_VALUES as readonly string[]).includes(key);

const projectsDir = () => path.join(backupDir(), "projects");
const projectFile = (id: string) => path.join(projectsDir(), `${id}.json`);
const INDEX_FILE = "index.json";
const indexFile = () => path.join(projectsDir(), INDEX_FILE);
const valueFile = (key: BackedUpValue) => path.join(backupDir(), "values", `${key.replace(":", "-")}.json`);

async function atomicWrite(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/**
 * The backup index (projects/index.json): id, title, date, size and format status of every
 * backed-up project, so listing, counting and the newer-copy check never open the
 * project files, which carry their images and can be many megabytes each.
 */
async function readIndex(): Promise<BackupIndex> {
  try {
    const data = JSON.parse(await readFile(indexFile(), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? (data as BackupIndex) : {};
  } catch {
    return {};
  }
}

// Index updates run one at a time (the server is one process), so saves from several tabs can't lose entries.
let indexQueue: Promise<unknown> = Promise.resolve();
function withIndex<T>(fn: (index: BackupIndex) => Promise<{ result: T; changed: boolean }>): Promise<T> {
  const run = indexQueue.then(async () => {
    const index = await readIndex();
    const { result, changed } = await fn(index);
    if (changed) await atomicWrite(indexFile(), JSON.stringify(index));
    return result;
  });
  indexQueue = run.catch(() => undefined);
  return run;
}

type StoredProject = { id: string; name?: string; updatedAt?: string; metadata?: { title?: string }; formats?: BackupEdition[] };

function entryFor(p: StoredProject, size: number, mtimeMs: number): IndexEntry {
  const editions = Array.isArray(p.formats) ? p.formats.map((f) => ({ kind: f.kind, enabled: f.enabled, kdp: { ...f.kdp } })) : undefined;
  return { id: p.id, title: p.metadata?.title || p.name || p.id, updatedAt: p.updatedAt ?? "", bytes: size, mtimeMs, ...(editions ? { editions } : {}) };
}

/** Saves a project unless the copy already there is newer (another tab's later save wins). Returns whether it wrote. */
export async function backupProject(project: { id: string; updatedAt?: string }): Promise<boolean> {
  if (!isProjectId(project.id)) throw new Error("Not a project id");
  return withIndex(async (index) => {
    const prevAt = index[project.id]?.updatedAt ?? (await readProjectBackup(project.id).catch(() => null))?.updatedAt;
    if (prevAt && project.updatedAt && prevAt > project.updatedAt) return { result: false, changed: false };
    const file = projectFile(project.id);
    await atomicWrite(file, JSON.stringify(project));
    const st = await stat(file);
    index[project.id] = entryFor(project as StoredProject, st.size, st.mtimeMs);
    return { result: true, changed: true };
  });
}

export async function readProjectBackup(id: string): Promise<{ id: string; updatedAt?: string; [k: string]: unknown } | null> {
  if (!isProjectId(id)) return null;
  try {
    return JSON.parse(await readFile(projectFile(id), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The index, checked against the folder: entries whose file is unchanged (same size and
 * time) are trusted, files with no entry or that changed outside BookStudio are read
 * once and indexed, and entries whose file is gone are dropped. Costs a `stat` per file.
 */
async function reconciledIndex(): Promise<IndexEntry[]> {
  return withIndex(async (index) => {
    let names: string[];
    try {
      names = (await readdir(projectsDir())).filter((n) => n.endsWith(".json") && n !== INDEX_FILE);
    } catch {
      names = [];
    }
    let changed = false;
    const seen = new Set<string>();
    for (const name of names) {
      const file = path.join(projectsDir(), name);
      let st;
      try {
        st = await stat(file);
      } catch {
        continue;
      }
      const id = name.slice(0, -".json".length);
      const known = index[id];
      if (known && known.bytes === st.size && Math.abs(known.mtimeMs - st.mtimeMs) < 1) {
        seen.add(id);
        continue;
      }
      try {
        const p = JSON.parse(await readFile(file, "utf8")) as StoredProject;
        if (!p?.id || p.id !== id) throw new Error("not a project");
        index[id] = entryFor(p, st.size, st.mtimeMs);
        seen.add(id);
        changed = true;
      } catch {
        // A half-written or foreign file: leave it out rather than fail the list.
      }
    }
    for (const id of Object.keys(index)) {
      if (!seen.has(id)) {
        delete index[id];
        changed = true;
      }
    }
    return { result: Object.values(index), changed };
  });
}

export async function listProjectBackups(): Promise<BackupSummary[]> {
  return (await reconciledIndex()).map(({ id, title, updatedAt, bytes }) => ({ id, title, updatedAt, bytes })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Each backed-up project's formats and their KDP status, from the index (undefined for projects saved before formats existed). */
export async function listBackupEditions(): Promise<{ id: string; title: string; editions?: BackupEdition[] }[]> {
  return (await reconciledIndex()).map(({ id, title, editions }) => ({ id, title, editions }));
}

/** Moves a deleted project's copy to trash/ so a mistaken delete can still be undone by hand. */
export async function trashProjectBackup(id: string): Promise<void> {
  if (!isProjectId(id)) return;
  const trash = path.join(backupDir(), "trash");
  await mkdir(trash, { recursive: true });
  await withIndex(async (index) => {
    await rename(projectFile(id), path.join(trash, `${id}.${Date.now()}.json`)).catch(() => undefined);
    const changed = id in index;
    delete index[id];
    return { result: undefined, changed };
  });
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
