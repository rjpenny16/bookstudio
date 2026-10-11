"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { AUTOPILOT_STEPS, runAutopilot, type AgentStep, type AutopilotResult } from "@/lib/agent/autopilot";
import { TRIM_SIZES } from "@/lib/kdp/rules";
import { BOOK_TYPES, type BookType } from "@/lib/schema/project";
import { saveProject } from "@/lib/storage/db";

const EXAMPLES: { topic: string; audience: string; bookType: BookType; trimId: string }[] = [
  { topic: "gratitude journal for nurses", audience: "nurses and healthcare workers", bookType: "journal", trimId: "6x9" },
  { topic: "large print sudoku", audience: "seniors", bookType: "puzzle", trimId: "8.5x11" },
  { topic: "ocean animals word search", audience: "kids ages 6-9", bookType: "puzzle", trimId: "8.5x11" },
  { topic: "fishing log book", audience: "anglers", bookType: "log-book", trimId: "6x9" },
];

export default function AutopilotPage() {
  return (
    <Suspense fallback={<div className="page muted">Loading…</div>}>
      <Autopilot />
    </Suspense>
  );
}

function Autopilot() {
  const params = useSearchParams();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [topic, setTopic] = useState(params.get("topic") ?? "");
  const [audience, setAudience] = useState(params.get("audience") ?? "");
  const [bookType, setBookType] = useState<BookType>("journal");
  const [trimId, setTrimId] = useState("6x9");
  const [author, setAuthor] = useState("");
  const [notes, setNotes] = useState(params.get("notes") ?? "");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<AutopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    aiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const start = async () => {
    setError(null);
    setResult(null);
    setRunning(true);
    setSteps(AUTOPILOT_STEPS.map((s) => ({ ...s, status: "pending" })));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await runAutopilot(
        { topic, audience, bookType, trimId, author: author || "Your Name", notes },
        (id, st, detail) => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, status: st, detail } : s))),
        ctrl.signal,
      );
      await saveProject(res.project);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>AI Autopilot</h1>
          <p>
            Describe the book. The agent writes a brief, builds the interior with deterministic generators, drafts the listing, designs the cover, runs KDP preflight and repairs what it safely can. It stops for your approval and never publishes for you.
          </p>
        </div>
      </div>
      <div className="split-aside">
        <div className="stack">
          <div className="card stack">
            <div className="field">
              <label>
                What is the book about?
                <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. gratitude journal for nurses" />
              </label>
            </div>
            <div className="chip-list" aria-label="Examples">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.topic}
                  className="chip"
                  onClick={() => {
                    setTopic(ex.topic);
                    setAudience(ex.audience);
                    setBookType(ex.bookType);
                    setTrimId(ex.trimId);
                  }}
                >
                  {ex.topic}
                </button>
              ))}
            </div>
            <div className="field-row">
              <div className="field">
                <label>
                  Audience
                  <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="who buys it?" />
                </label>
              </div>
              <div className="field">
                <label>
                  Book type
                  <select value={bookType} onChange={(e) => setBookType(e.target.value as BookType)}>
                    {BOOK_TYPES.filter((t) => t.id !== "coloring" && t.id !== "other").map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="field">
                <label>
                  Trim
                  <select value={trimId} onChange={(e) => setTrimId(e.target.value)}>
                    {TRIM_SIZES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="field">
                <label>
                  Author / pen name
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} />
                </label>
              </div>
            </div>
            <div className="field">
              <label>
                Notes (optional)
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Tone, must-haves, things to avoid" />
              </label>
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={start} disabled={running || !topic.trim()}>
                {running && <span className="spinner" />} {running ? "Working…" : "Run autopilot"}
              </button>
              {running && (
                <button className="btn" onClick={() => abortRef.current?.abort()}>
                  Cancel
                </button>
              )}
            </div>
          </div>

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
              <p style={{ margin: 0 }}>
                <b>{result.project.metadata.title}</b>: {result.project.interior.pages.length} pages, preflight {result.report.passed}/{result.report.total}
                {result.report.blocking ? `, ${result.report.blocking} blocking` : ""}.
              </p>
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
                Human checkpoint: review the interior and cover, edit the listing, and confirm the AI disclosure on the Listing tab before exporting.
              </div>
              <div className="row">
                <Link className="btn btn-primary" href={`/projects/${result.project.id}#interior`}>
                  Open in studio
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
