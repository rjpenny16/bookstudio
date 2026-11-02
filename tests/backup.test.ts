import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupProject, backupValue, isProjectId, listBackupEditions, listProjectBackups, readProjectBackup, readValueBackups, trashProjectBackup } from "@/lib/storage/backup";
import { backupRefs } from "@/lib/inbox/quota";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "bookstudio-backup-"));
  process.env.BACKUP_DIR = dir;
});
afterEach(async () => {
  delete process.env.BACKUP_DIR;
  await rm(dir, { recursive: true, force: true });
});

const project = (id: string, updatedAt: string, title = "A Book") => ({ id, updatedAt, name: title, metadata: { title } });

describe("server backup", () => {
  it("keeps a copy of each project and lists them newest first", async () => {
    await backupProject(project("prj_a", "2026-10-01T00:00:00Z", "Older"));
    await backupProject(project("prj_b", "2026-10-02T00:00:00Z", "Newer"));
    const list = await listProjectBackups();
    expect(list.map((p) => p.title)).toEqual(["Newer", "Older"]);
    expect(list[0].bytes).toBeGreaterThan(0);
    expect((await readProjectBackup("prj_a"))?.updatedAt).toBe("2026-10-01T00:00:00Z");
  });

  it("doesn't let an older save overwrite a newer copy", async () => {
    expect(await backupProject(project("prj_a", "2026-10-02T00:00:00Z", "Second"))).toBe(true);
    expect(await backupProject(project("prj_a", "2026-10-01T00:00:00Z", "First"))).toBe(false);
    expect((await readProjectBackup("prj_a"))?.name).toBe("Second");
  });

  it("moves deleted projects to trash instead of deleting them", async () => {
    await backupProject(project("prj_a", "2026-10-01T00:00:00Z"));
    await trashProjectBackup("prj_a");
    expect(await listProjectBackups()).toEqual([]);
    expect((await readdir(path.join(dir, "trash"))).length).toBe(1);
  });

  it("rejects ids that could reach outside the folder", async () => {
    expect(isProjectId("../etc/passwd")).toBe(false);
    expect(isProjectId("prj_ok-1")).toBe(true);
    await expect(backupProject({ id: "../x" })).rejects.toThrow();
    expect(await readProjectBackup("../x")).toBeNull();
  });

  it("keeps research and sales data", async () => {
    await backupValue("sales:rows", [{ title: "T", units: 3 }]);
    const v = await readValueBackups();
    expect(v["sales:rows"]?.value).toEqual([{ title: "T", units: 3 }]);
    expect(v["research:boards"]).toBeUndefined();
  });
});

describe("backup index", () => {
  const file = (id: string) => path.join(dir, "projects", `${id}.json`);
  const index = async () => JSON.parse(await readFile(path.join(dir, "projects", "index.json"), "utf8"));

  it("lists from the index without opening project files", async () => {
    await backupProject(project("prj_a", "2026-10-01T00:00:00Z", "Indexed title"));
    // Replace the file's content with junk of the same size, keeping its time: only the index can answer.
    const st = await stat(file("prj_a"));
    await writeFile(file("prj_a"), "x".repeat(st.size));
    await utimes(file("prj_a"), st.atime, st.mtime);
    expect((await listProjectBackups()).map((b) => b.title)).toEqual(["Indexed title"]);
    expect((await readdir(path.join(dir, "projects"))).sort()).toEqual(["index.json", "prj_a.json"]);
  });

  it("indexes a file copied in by hand, re-reads a changed one, and drops a removed one", async () => {
    await backupProject(project("prj_a", "2026-10-01T00:00:00Z", "A"));
    await backupProject(project("prj_b", "2026-10-02T00:00:00Z", "B"));
    await writeFile(file("prj_c"), JSON.stringify(project("prj_c", "2026-10-03T00:00:00Z", "Copied in")));
    await writeFile(file("prj_a"), JSON.stringify(project("prj_a", "2026-10-04T00:00:00Z", "Edited by hand, longer")));
    await rm(file("prj_b"));
    expect((await listProjectBackups()).map((b) => b.title)).toEqual(["Edited by hand, longer", "Copied in"]);
    expect(Object.keys(await index()).sort()).toEqual(["prj_a", "prj_c"]);
  });

  it("rebuilds a missing or corrupt index", async () => {
    await backupProject(project("prj_a", "2026-10-01T00:00:00Z", "A"));
    await writeFile(path.join(dir, "projects", "index.json"), "{not json");
    expect((await listProjectBackups()).map((b) => b.id)).toEqual(["prj_a"]);
    await rm(path.join(dir, "projects", "index.json"));
    expect((await listProjectBackups()).map((b) => b.id)).toEqual(["prj_a"]);
    expect(Object.keys(await index())).toEqual(["prj_a"]);
  });

  it("keeps every entry when many tabs save at once", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => backupProject(project(`prj_${i}`, `2026-10-01T00:00:${String(i).padStart(2, "0")}Z`))));
    expect(Object.keys(await index())).toHaveLength(20);
    expect(await listProjectBackups()).toHaveLength(20);
  });

  it("checks for a newer copy from the index and removes trashed projects from it", async () => {
    await backupProject(project("prj_a", "2026-10-02T00:00:00Z", "Second"));
    expect(await backupProject(project("prj_a", "2026-10-01T00:00:00Z", "First"))).toBe(false);
    expect((await index()).prj_a.title).toBe("Second");
    await trashProjectBackup("prj_a");
    expect(await index()).toEqual({});
  });

  it("keeps each format's KDP status for the inbox quota", async () => {
    const formats = [
      { kind: "paperback", enabled: true, kdp: { status: "created", createdAt: "2026-11-02T00:00:00Z" } },
      { kind: "hardcover", enabled: true, kdp: { status: "planned", plannedWeek: "2026-11-01" } },
    ];
    await backupProject({ ...project("prj_a", "2026-11-02T00:00:00Z", "Formats"), formats } as { id: string });
    expect((await listBackupEditions())[0]).toMatchObject({ id: "prj_a", title: "Formats", editions: formats });
    const refs = await backupRefs();
    expect(refs.map((r) => [r.projectId, r.edition.kind, r.edition.kdp.status])).toEqual([
      ["prj_a", "paperback", "created"],
      ["prj_a", "hardcover", "planned"],
    ]);
  });
});
