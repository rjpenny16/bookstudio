"use client";

import { useEffect, useState } from "react";
import { migrateProject } from "@/lib/schema/migrate";
import type { Project } from "@/lib/schema/project";
import { getValue, listProjects, saveProject, setValue, type ProjectSummary } from "@/lib/storage/db";
import { syncBackups } from "@/lib/storage/backupSync";
import { backupHealth } from "@/lib/storage/mirror";

interface BackupSummary {
  id: string;
  title: string;
  updatedAt: string;
  bytes: number;
}
interface BackupList {
  dir: string;
  projects: BackupSummary[];
  values: Record<string, { savedAt: string; value: unknown } | undefined>;
}

const VALUE_LABELS: Record<string, string> = { "research:boards": "Research boards", "sales:rows": "Sales reports", "sales:curve": "Sales rank calibration" };
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

interface Loaded {
  list: BackupList;
  local: ProjectSummary[];
  /** Backed-up values this browser has none of. */
  missing: string[];
}

async function loadBackups(): Promise<Loaded> {
  await syncBackups();
  const res = await fetch("/api/backup");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const list = (await res.json()) as BackupList;
  const missing: string[] = [];
  for (const [key, v] of Object.entries(list.values)) if (v?.value && !(await getValue(key))) missing.push(key);
  return { list, local: await listProjects(), missing };
}

/** Settings: the server-side copy of every project, and a way to bring back what this browser doesn't have. */
export function BackupCard() {
  const [list, setList] = useState<BackupList | null>(null);
  const [local, setLocal] = useState<ProjectSummary[]>([]);
  const [missingValues, setMissingValues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (r: Loaded) => {
    setList(r.list);
    setLocal(r.local);
    setMissingValues(r.missing);
  };
  const fail = (e: unknown) => setError(`Couldn't reach the backup: ${e instanceof Error ? e.message : e}`);
  const refresh = () => loadBackups().then(apply, fail);
  useEffect(() => {
    loadBackups().then(apply, fail);
  }, []);

  const localById = new Map(local.map((p) => [p.id, p]));
  const restorable = (list?.projects ?? []).filter((b) => {
    const l = localById.get(b.id);
    return !l || b.updatedAt > l.updatedAt;
  });

  const restore = async (ids: string[], keys: string[]) => {
    setBusy(true);
    setNote(null);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/backup?id=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`Backup of ${id} not found`);
        await saveProject(migrateProject((await res.json()) as Project));
      }
      for (const key of keys) await setValue(key, list?.values[key]?.value);
      setNote(`Restored ${[ids.length && `${ids.length} project(s)`, keys.length && keys.map((k) => VALUE_LABELS[k] ?? k).join(", ")].filter(Boolean).join(" and ")}.`);
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const health = backupHealth();
  return (
    <div className="card stack" data-testid="backup-card">
      <h2 style={{ margin: 0 }}>Backup</h2>
      <p className="muted" style={{ margin: 0 }}>
        Every project you save is also copied to the computer running BookStudio{list ? <> (<code>{list.dir}</code>)</> : null}, along with research boards and sales reports. If this browser&apos;s data is cleared, or you open BookStudio in another browser, restore from here.
      </p>
      {error && <div className="notice notice-warn">{error}</div>}
      {health.lastError && <div className="notice notice-warn">The last backup failed: {health.lastError.message}</div>}
      {list && (
        <>
          <p style={{ margin: 0, fontSize: 13 }}>
            {list.projects.length} project(s) backed up, {list.projects.reduce((n, p) => n + p.bytes, 0) > 0 ? size(list.projects.reduce((n, p) => n + p.bytes, 0)) : "nothing yet"}.
          </p>
          {restorable.length + missingValues.length === 0 ? (
            <div className="notice notice-pass">Everything in the backup is in this browser too.</div>
          ) : (
            <>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {restorable.map((b) => (
                  <li key={b.id}>
                    {b.title} <span className="muted">({localById.has(b.id) ? "newer than this browser's copy" : "not in this browser"}, saved {b.updatedAt.slice(0, 16).replace("T", " ")})</span>{" "}
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => restore([b.id], [])}>Restore</button>
                  </li>
                ))}
                {missingValues.map((k) => (
                  <li key={k}>
                    {VALUE_LABELS[k] ?? k} <span className="muted">(not in this browser)</span>
                  </li>
                ))}
              </ul>
              <div>
                <button className="btn btn-sm" disabled={busy} onClick={() => restore(restorable.map((b) => b.id), missingValues)}>
                  {busy && <span className="spinner" />} Restore everything listed
                </button>
              </div>
            </>
          )}
        </>
      )}
      {note && <div className="notice notice-info" role="status">{note}</div>}
    </div>
  );
}
