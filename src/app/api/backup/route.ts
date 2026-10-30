import { NextResponse } from "next/server";
import { backupDir, backupProject, backupValue, isBackedUpValue, isProjectId, listProjectBackups, readProjectBackup, readValueBackups, trashProjectBackup } from "@/lib/storage/backup";

export const runtime = "nodejs";

/** GET: the backed-up projects (or one, with ?id=) and values. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const p = await readProjectBackup(id);
    return p ? NextResponse.json(p) : NextResponse.json({ error: "No backup of that project" }, { status: 404 });
  }
  return NextResponse.json({ dir: backupDir(), projects: await listProjectBackups(), values: await readValueBackups() });
}

/** POST { project } or { key, value }: keep a copy. */
export async function POST(req: Request) {
  let body: { project?: { id?: unknown; updatedAt?: string }; key?: unknown; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  try {
    if (body.project) {
      if (!isProjectId(body.project.id)) return NextResponse.json({ error: "project.id is missing or invalid" }, { status: 400 });
      return NextResponse.json({ saved: await backupProject(body.project as { id: string; updatedAt?: string }) });
    }
    if (isBackedUpValue(body.key)) {
      await backupValue(body.key, body.value);
      return NextResponse.json({ saved: true });
    }
    return NextResponse.json({ error: "Send { project } or { key, value } with a backed-up key" }, { status: 400 });
  } catch (err) {
    console.error("Backup failed", err);
    return NextResponse.json({ error: `Backup failed: ${err instanceof Error ? err.message : err}` }, { status: 500 });
  }
}

/** DELETE ?id=: move a deleted project's copy to trash. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!isProjectId(id)) return NextResponse.json({ error: "id is missing or invalid" }, { status: 400 });
  await trashProjectBackup(id);
  return NextResponse.json({ trashed: true });
}
