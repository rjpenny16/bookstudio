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
import { CostEstimate, emptySetup, EXAMPLES, SetupForm, setupToParams, type SetupState } from "@/components/autopilot/SetupForm";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { imageStatus, type ImageStatus } from "@/lib/cover/artClient";

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
  const [setup, setSetup] = useState<SetupState>(emptySetup);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [images, setImages] = useState<ImageStatus | null>(null);

  const refresh = () => listProjects().then(setProjects);
  useEffect(() => {
    refresh();
    aiStatus().then(setStatus).catch(() => setStatus(null));
    imageStatus().then(setImages).catch(() => setImages(null));
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
      <form
        className="card stack quick-start"
        aria-labelledby="quick-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (!setup.topic.trim()) return;
          const q = setupToParams(setup);
          q.set("go", "1");
          router.push(`/autopilot?${q}`);
        }}
      >
        <div>
          <h2 id="quick-start" style={{ margin: 0 }}>
            Make a book
          </h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Name the niche and the reader. Autopilot plans the sections, writes the content, designs the cover and listing, checks everything against KDP&apos;s rules, and stops for your review. It never publishes for you.
          </p>
        </div>
        <SetupForm value={setup} onChange={setSetup} images={images} />
        <div className="chip-list" aria-label="Examples">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex.topic} className="chip" onClick={() => setSetup((s) => ({ ...s, topic: ex.topic, audience: ex.audience, bookType: undefined, trimId: undefined }))}>
              {ex.topic}
            </button>
          ))}
        </div>
        <CostEstimate setup={setup} status={status} images={images} />
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={!setup.topic.trim()}>
            Create my book
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            {status ? `${status.provider === "offline" ? "Offline templates" : status.model}${images?.configured ? ` · cover art by ${images.model}` : ""}` : ""}
          </span>
        </div>
      </form>
      <div className="hero-actions">
        <Link href="/new" className="action-card">
          <span className="kicker">Blank project</span>
          <strong>Start from a KDP preset</strong>
          <span>Pick trim, paper and an interior generator, and build the book yourself. Bleed, spine and margins are set for you.</span>
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
          <p>No books yet. Describe one above, or start from a KDP preset.</p>
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
