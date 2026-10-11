"use client";

import { useEffect, useState } from "react";
import { coverGeometry } from "@/lib/kdp/geometry";
import { buildKdpPackage, downloadBlob, metadataCsv, metadataJson, PROJECT_FILE, slug } from "@/lib/export/package";
import type { PreflightReport } from "@/lib/preflight";
import { canvasToBlob, ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import { browserFontLoader } from "@/lib/render/fonts";
import { renderMockup } from "@/lib/render/mockup";
import { renderCoverPdf, renderInteriorPdf } from "@/lib/render/pdf";
import type { Project } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";

async function coverImages(project: Project) {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const scale = 1600 / cg.front.width / 1.5;
  const full = rasterize({ widthPt: cg.width, heightPt: cg.height, scale, background: project.cover.background, elements: project.cover.elements, images });
  const crop = (b: { x: number; y: number; width: number; height: number }) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(b.width * scale));
    c.height = Math.round(b.height * scale);
    c.getContext("2d")!.drawImage(full, Math.round(b.x * scale), Math.round(b.y * scale), c.width, c.height, 0, 0, c.width, c.height);
    return c;
  };
  const front = crop(cg.front);
  const spine = cg.spine > 2 ? crop(cg.spineBox) : null;
  return { full, front, mockup: renderMockup(front, spine) };
}

export function ExportTab({ report, onGoPreflight }: { report: PreflightReport; onGoPreflight: () => void }) {
  const project = useProjectStore((s) => s.project)!;
  const [mockupUrl, setMockupUrl] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [progress, setProgress] = useState<{ label: string; f: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = slug(project.metadata.title || project.name);
  const draft = report.blocking > 0;

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    const t = setTimeout(async () => {
      const { mockup } = await coverImages(project);
      if (cancelled) return;
      url = URL.createObjectURL(await canvasToBlob(mockup));
      setMockupUrl(url);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [project]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setProgress({ label, f: 0 });
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const fullPackage = () =>
    run("Building package", async () => {
      const { full, mockup } = await coverImages(project);
      const blob = await buildKdpPackage(project, {
        loadFont: browserFontLoader,
        coverPreviewPng: await canvasToBlob(full),
        mockupPng: await canvasToBlob(mockup),
        onProgress: (label, f) => setProgress({ label, f }),
      });
      downloadBlob(blob, `${name}-kdp${draft ? "-draft" : ""}.zip`);
    });

  return (
    <div className="split-aside">
      <div className="stack">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>KDP publication package</h2>
          <p className="muted" style={{ margin: 0 }}>
            One zip with print-ready <code>interior.pdf</code> and <code>cover.pdf</code>, listing metadata (JSON + CSV), keyword sheet, preflight report, AI provenance, font/asset licenses, a cover preview and mockup, the editable project file, and step-by-step upload instructions.
          </p>
          {draft ? (
            <div className="notice notice-fail">
              {report.blocking} blocking preflight issue{report.blocking > 1 ? "s" : ""}. You can export a draft, but KDP will likely reject it.{" "}
              <button className="btn btn-sm" onClick={onGoPreflight}>
                Review preflight
              </button>
            </div>
          ) : (
            <div className="notice notice-pass">Preflight passed ({report.passed}/{report.total}).</div>
          )}
          <label className="check">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            <span>I reviewed the interior, cover and listing, and I hold the rights to everything in this book.</span>
          </label>
          <div className="row">
            <button className="btn btn-primary" disabled={!approved || !!progress} onClick={fullPackage}>
              Download {draft ? "draft " : ""}KDP package (.zip)
            </button>
          </div>
          {progress && (
            <div className="stack" aria-live="polite">
              <span className="muted" style={{ fontSize: 12 }}>
                <span className="spinner" /> {progress.label}…
              </span>
              <div className="progress">
                <div style={{ width: `${Math.round(progress.f * 100)}%` }} />
              </div>
            </div>
          )}
          {error && <div className="notice notice-fail">{error}</div>}
          <p className="field-hint" style={{ margin: 0 }}>
            BookStudio does not log in to KDP or publish for you. Upload the files in KDP, check the Print Previewer and press Publish yourself.
          </p>
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>Individual files</h2>
          <div className="row">
            <button
              className="btn"
              disabled={!!progress}
              onClick={() =>
                run("Rendering interior", async () => {
                  const bytes = await renderInteriorPdf(project, { loadFont: browserFontLoader, onProgress: (d, t) => setProgress({ label: "Rendering interior", f: d / t }) });
                  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${name}-interior.pdf`);
                })
              }
            >
              interior.pdf
            </button>
            <button
              className="btn"
              disabled={!!progress}
              onClick={() =>
                run("Rendering cover", async () => {
                  const bytes = await renderCoverPdf(project, { loadFont: browserFontLoader });
                  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${name}-cover.pdf`);
                })
              }
            >
              cover.pdf
            </button>
            <button className="btn" onClick={() => downloadBlob(new Blob([JSON.stringify(metadataJson(project), null, 2)], { type: "application/json" }), `${name}-metadata.json`)}>
              metadata.json
            </button>
            <button className="btn" onClick={() => downloadBlob(new Blob([metadataCsv(project)], { type: "text/csv" }), `${name}-metadata.csv`)}>
              metadata.csv
            </button>
            <button className="btn" onClick={() => downloadBlob(new Blob([JSON.stringify(project)], { type: "application/json" }), `${name}.${PROJECT_FILE}`)}>
              Project file
            </button>
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            The project file is a portable, documented JSON format (schema {project.schemaVersion}). Import it on any BookStudio install.
          </p>
        </div>
      </div>
      <aside className="stack sticky-aside">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Mockup</h2>
          {mockupUrl ? <img className="mockup-img" src={mockupUrl} alt="Paperback mockup of the front cover" /> : <div className="empty">Rendering…</div>}
          {mockupUrl && (
            <a className="btn btn-sm" href={mockupUrl} download={`${name}-mockup.png`}>
              Download mockup PNG
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}
