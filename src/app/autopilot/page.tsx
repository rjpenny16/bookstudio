"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { AUTOPILOT_STEPS, runAutopilot, type AgentStep, type AutopilotResult } from "@/lib/agent/autopilot";
import { imageStatus, type ImageStatus } from "@/lib/cover/artClient";
import type { Project } from "@/lib/schema/project";
import { saveProject } from "@/lib/storage/db";
import { LiveBuild } from "@/components/autopilot/LiveBuild";
import { artEnabled, CostEstimate, EXAMPLES, resolveSetup, SetupForm, setupFromParams, type SetupState } from "@/components/autopilot/SetupForm";


export default function AutopilotPage() {
  return (
    <Suspense fallback={<div className="page muted">Loading…</div>}>
      <Autopilot />
    </Suspense>
  );
}

function Autopilot() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [images, setImages] = useState<ImageStatus | null>(null);
  const [setup, setSetup] = useState<SetupState>(() => setupFromParams(params));
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [preview, setPreview] = useState<{ project: Project; hasCover: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);

  useEffect(() => {
    aiStatus().then(setStatus).catch(() => setStatus(null));
    imageStatus().then(setImages).catch(() => setImages(null));
  }, []);

  const start = async (thenReview = false) => {
    setError(null);
    setResult(null);
    setPreview(null);
    setRunning(true);
    setSteps(AUTOPILOT_STEPS.map((s) => ({ ...s, status: "pending" })));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { bookType, trimId } = resolveSetup(setup);
    try {
      const res = await runAutopilot(
        {
          topic: setup.topic,
          audience: setup.audience,
          bookType,
          trimId,
          author: setup.author || "Your Name",
          notes: setup.notes,
          coverArt: artEnabled(setup, images),
          pageTarget: setup.pageTarget,
          style: setup.templateId || setup.paletteId ? { templateId: setup.templateId, paletteId: setup.paletteId } : undefined,
        },
        (id, st, detail) => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status: st, detail } : s))),
        ctrl.signal,
        (project, stage) => setPreview({ project, hasCover: stage === "cover" || stage === "done" }),
      );
      await saveProject(res.project);
      setResult(res);
      if (thenReview) router.push(`/projects/${res.project.id}#review`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  // The one-screen start on the home page lands here with go=1: run once both statuses are known, then open Review & Publish.
  useEffect(() => {
    if (params.get("go") !== "1" || autoStarted.current || !status || !images || !setup.topic.trim()) return;
    autoStarted.current = true;
    void Promise.resolve().then(() => start(true));
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Autopilot</h1>
          <p>
            Describe the book. The agent writes a brief, plans the sections (how-to page, difficulty ramp, contents, answer keys), writes their content and replaces anything repeated or weak, builds the interior with deterministic generators, drafts and critiques the listing, designs the cover and has the model look at it, runs KDP preflight and repairs what it safely can. It stops for your approval and never publishes for you.
          </p>
        </div>
      </div>
      <div className="split-aside">
        <div className="stack">
          <div className="card stack">
            <SetupForm value={setup} onChange={setSetup} images={images} disabled={running} />
            <div className="chip-list" aria-label="Examples">
              {EXAMPLES.map((ex) => (
                <button key={ex.topic} className="chip" disabled={running} onClick={() => setSetup((s) => ({ ...s, topic: ex.topic, audience: ex.audience, bookType: undefined, trimId: undefined }))}>
                  {ex.topic}
                </button>
              ))}
            </div>
            <CostEstimate setup={setup} status={status} images={images} />
            <div className="row">
              <button className="btn btn-primary" onClick={() => start()} disabled={running || !setup.topic.trim()}>
                {running && <span className="spinner" />} {running ? "Working…" : "Run autopilot"}
              </button>
              {running && (
                <button className="btn" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          {(running || preview) && !result && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Your book so far</h2>
              <LiveBuild project={preview?.project ?? null} hasCover={preview?.hasCover ?? false} />
            </div>
          )}

          {steps.length > 0 && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Run log</h2>
              <ol className="steps" aria-live="polite">
                {steps.map((s, i) => (
                  <li key={s.id} className={`step ${s.status}`}>
                    <span className="step-dot">{s.status === "done" ? "✓" : s.status === "error" ? "!" : s.status === "running" ? <span className="spinner" /> : i + 1}</span>
                    <div>
                      <strong>{s.label}</strong>
                      {s.detail && <div className="step-detail">{s.detail}</div>}
                    </div>
                  </li>
                ))}
              </ol>
              {error && <div className="notice notice-fail">{error}</div>}
            </div>
          )}

          {result && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Draft ready for your review</h2>
              <LiveBuild project={result.project} hasCover />
              <p style={{ margin: 0 }}>
                <b>{result.project.metadata.title}</b>: {result.project.interior.pages.length} pages, preflight {result.report.passed}/{result.report.total}
                {result.report.blocking ? `, ${result.report.blocking} blocking` : ""}.
              </p>
              {result.project.interior.sections.some((s) => s.role === "body") && (
                <div>
                  <strong>What&apos;s inside</strong>
                  <ul aria-label="Book sections" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {result.project.interior.sections
                      .filter((s) => s.role === "body" && s.config.kind !== "section-divider")
                      .map((s) => (
                        <li key={s.id}>
                          {s.label}: {result.project.interior.pages.filter((p) => p.sectionId === s.id).length} pages
                        </li>
                      ))}
                    <li>
                      Plus: {result.project.interior.sections.filter((s) => s.role !== "body" && !s.label.endsWith(": answers")).map((s) => s.label).join(", ")}
                    </li>
                  </ul>
                </div>
              )}
              <div>
                <strong>Quality review</strong>
                <ul aria-label="Quality review" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  <li>
                    Rule checks: {result.quality.counts.high} high, {result.quality.counts.medium} medium, {result.quality.counts.low} low
                  </li>
                  {result.quality.reviews.listing && result.quality.reviews.listing.provider !== "offline" && (
                    <li>
                      Listing critique: {result.quality.reviews.listing.score}/10 · {result.quality.reviews.listing.summary}
                    </li>
                  )}
                  {result.quality.reviews.visual && (
                    <li>
                      Cover &amp; pages: {result.quality.reviews.visual.score}/10{result.quality.reviews.visual.thumbnailReadable ? "" : " · title hard to read as a thumbnail"} · {result.quality.reviews.visual.summary}
                    </li>
                  )}
                </ul>
              </div>
              {result.project.coverArt?.chosenId && (
                <div>
                  <strong>Cover art</strong>
                  <p style={{ margin: "4px 0 0" }}>
                    Picked &ldquo;{result.project.coverArt.candidates.find((c) => c.id === result.project.coverArt!.chosenId)?.name}&rdquo; of {result.project.coverArt.candidates.length}: {result.project.coverArt.pickReason}. The others are on the Cover tab.
                  </p>
                </div>
              )}
              {result.notes.length > 0 && (
                <div className="notice notice-info">
                  {result.notes.map((n, i) => (
                    <div key={i}>{n}</div>
                  ))}
                </div>
              )}
              {result.repairs.length > 0 && (
                <details>
                  <summary>{result.repairs.length} automatic repair(s)</summary>
                  <ul>
                    {result.repairs.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="notice notice-info">
                Human checkpoint: flip through the pages, check the cover and listing, and confirm the AI disclosure on the Review &amp; Publish screen before exporting.
              </div>
              <div className="row">
                <Link className="btn btn-primary" href={`/projects/${result.project.id}#review`}>
                  Review &amp; Publish
                </Link>
                <Link className="btn" href={`/projects/${result.project.id}#interior`}>
                  Open in studio
                </Link>
                <Link className="btn" href={`/projects/${result.project.id}#quality`}>
                  Quality review
                </Link>
                <Link className="btn" href={`/projects/${result.project.id}#listing`}>
                  Review listing
                </Link>
              </div>
            </div>
          )}
        </div>
        <aside className="stack sticky-aside">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Model</h2>
            {status ? (
              <>
                <span className={`badge ${status.provider === "offline" ? "badge-warn" : "badge-pass"}`}>
                  {status.provider} · {status.model}
                </span>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {status.detail}
                </p>
                {status.provider === "offline" && (
                  <p className="field-hint" style={{ margin: 0 }}>
                    Offline mode uses built-in templates instead of a language model, so nothing is flagged as AI-generated. Set <code>ANTHROPIC_API_KEY</code> or <code>AI_PROVIDER=ollama</code> for real drafting. See <Link href="/settings">Settings</Link>.
                  </p>
                )}
              </>
            ) : (
              <span className="muted">Checking…</span>
            )}
            <h3 style={{ margin: "8px 0 0" }}>Cover art</h3>
            {images ? (
              <>
                <span className={`badge ${images.configured ? "badge-pass" : "badge-warn"}`}>{images.configured ? `${images.provider} · ${images.model}` : "none"}</span>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {images.detail}
                </p>
              </>
            ) : (
              <span className="muted">Checking…</span>
            )}
          </div>
          <div className="card">
            <h3>What the agent can and cannot do</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-2)" }}>
              <li>Uses validated domain operations, not mouse clicks.</li>
              <li>Puzzles are generated and verified by code (unique sudoku, solvable mazes).</li>
              <li>Every model call is recorded for KDP AI disclosure.</li>
              <li>It does not research live Amazon data or publish to KDP.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
