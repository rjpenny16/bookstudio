"use client";

import { listProjects, loadProject } from "./db";

/**
 * Catches the backup up with this browser: any project saved here that the
 * server has no copy of, or an older one (a tab closed before its backup
 * went out, say), is sent now. Runs once a session; callers share the run.
 */

let running: Promise<number> | null = null;

export function syncBackups(): Promise<number> {
  return (running ??= run().catch(() => 0));
}

async function run(): Promise<number> {
  const res = await fetch("/api/backup");
  if (!res.ok) return 0;
  const { projects } = (await res.json()) as { projects: { id: string; updatedAt: string }[] };
  const backedUp = new Map(projects.map((p) => [p.id, p.updatedAt]));
  let sent = 0;
  for (const s of await listProjects()) {
    const at = backedUp.get(s.id);
    if (at && at >= s.updatedAt) continue;
    const p = await loadProject(s.id);
    if (!p) continue;
    const r = await fetch("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: p }) });
    if (r.ok) sent++;
  }
  return sent;
}
