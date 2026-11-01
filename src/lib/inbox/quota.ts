import { addWeeks, quotaSummary, weekItems, weekKey, type EditionRef } from "@/lib/kdp/quota";
import { FORMAT_KINDS, FORMAT_LABEL } from "@/lib/schema/formats";
import { migrateProject } from "@/lib/schema/migrate";
import type { Project } from "@/lib/schema/project";
import { listProjectBackups, readProjectBackup } from "@/lib/storage/backup";

/** Planner refs from the server's backup copies of the projects (the browser keeps the originals). */
export async function backupRefs(): Promise<EditionRef[]> {
  const refs: EditionRef[] = [];
  for (const b of await listProjectBackups()) {
    const raw = await readProjectBackup(b.id);
    if (!raw || !raw.metadata) continue;
    const p = migrateProject(raw as unknown as Project);
    for (const edition of p.formats) refs.push({ projectId: p.id, title: p.metadata.title || p.name, edition });
  }
  return refs;
}

/** Reply to `quota`: this week's KDP slots per format, and what is planned this week and next. */
export async function quotaText(now = Date.now()): Promise<string> {
  const refs = await backupRefs();
  const lines = ["**This week on KDP**", quotaSummary(refs, now, FORMAT_LABEL)];
  for (const [label, week] of [["This week", weekKey(now)], ["Next week", addWeeks(weekKey(now), 1)]] as const) {
    const planned = FORMAT_KINDS.flatMap((k) => weekItems(refs, week, k).filter((r) => r.edition.kdp.status === "planned").map((r) => `${r.title} (${FORMAT_LABEL[k]})`));
    if (planned.length) lines.push(`**${label}, planned**`, ...planned.map((t) => `• ${t}`));
  }
  return lines.join("\n");
}
