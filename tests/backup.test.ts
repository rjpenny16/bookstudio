import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupProject, backupValue, isProjectId, listProjectBackups, readProjectBackup, readValueBackups, trashProjectBackup } from "@/lib/storage/backup";

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
