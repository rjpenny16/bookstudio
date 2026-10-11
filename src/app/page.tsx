"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { coverGeometry } from "@/lib/kdp/geometry";
import { parseProjectFile } from "@/lib/export/package";
import type { Project } from "@/lib/schema/project";
import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from "@/lib/storage/db";
import { newId } from "@/lib/util/ids";
import { PageThumb } from "@/components/workspace/PageThumb";

function CoverThumb({ id }: { id: string }) {
  const [p, setP] = useState<Project | null>(null);
  useEffect(() => {
    loadProject(id).then((x) => setP(x ?? null));
  }, [id]);
  if (!p) return null;
  const cg = coverGeometry(p.spec, p.interior.pages.length);
  return <PageThumb elements={p.cover.elements} widthPt={cg.trimW} heightPt={cg.trimH} originX={-cg.front.x} originY={-cg.front.y} background={p.cover.background} assets={p.assets} px={260} alt="" />;
}

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setProjects);
  useEffect(() => {
    refresh();
  }, []);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const p = parseProjectFile(await file.text());
      if (await loadProject(p.id)) p.id = newId("prj");
      await saveProject(p);
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Your books</h1>
          <p>Research a niche, generate an interior and cover, write the listing, pass KDP preflight and download a ready-to-upload package.</p>
        </div>
      </div>
      <div className="hero-actions">
        <Link href="/autopilot" className="action-card">
          <span className="kicker">AI Autopilot</span>
          <strong>Describe a book, get a draft</strong>
          <span>Brief → interior → listing → cover → preflight, with every step editable and logged.</span>
        </Link>
        <Link href="/new" className="action-card">
          <span className="kicker">Studio</span>
          <strong>Start from a KDP preset</strong>
          <span>Pick trim, paper and an interior generator. Bleed, spine and margins are set for you.</span>
        </Link>
        <button className="action-card" onClick={() => fileRef.current?.click()}>
          <span className="kicker">Import</span>
          <strong>Open a project file</strong>
          <span>Load a portable .bookstudio.json project exported from any BookStudio install.</span>
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      </div>
      {error && <div className="notice notice-fail" style={{ marginBottom: 16 }}>{error}</div>}
      <h2>Projects</h2>
      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <p>No books yet. Start with the Autopilot or a KDP preset.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <div key={p.id} className="stack" style={{ gap: 6 }}>
              <Link href={`/projects/${p.id}`} className="project-card">
                <div className="project-thumb">
                  <CoverThumb id={p.id} />
                </div>
                <strong style={{ fontSize: 13 }}>{p.title || p.name}</strong>
              </Link>
              <div className="row-between">
                <span className="muted" style={{ fontSize: 12 }}>
                  {p.trimId}" · {p.pages} pp · {new Date(p.updatedAt).toLocaleDateString()}
                </span>
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  aria-label={`Delete ${p.title || p.name}`}
                  onClick={async () => {
                    if (!confirm(`Delete "${p.title || p.name}"? This cannot be undone.`)) return;
                    await deleteProject(p.id);
                    refresh();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
