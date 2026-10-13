"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TRIM_SIZES } from "@/lib/kdp/rules";
import type { InboxItem } from "@/lib/inbox/state";
import { setRunnerState, useRunnerState } from "@/lib/inbox/runnerState";

const STATUS: Record<InboxItem["status"], { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "badge-info" },
  building: { label: "Building", cls: "badge-accent" },
  ready: { label: "Ready to review", cls: "badge-pass" },
  failed: { label: "Failed", cls: "badge-fail" },
};

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function details(it: InboxItem): string {
  const bits: string[] = [];
  if (it.idea.audience) bits.push(`for ${it.idea.audience}`);
  if (it.idea.pageTarget) bits.push(`${it.idea.pageTarget} pages`);
  if (it.idea.trimId) bits.push(TRIM_SIZES.find((t) => t.id === it.idea.trimId)?.label ?? it.idea.trimId);
  if (!it.idea.coverArt) bits.push("no cover art");
  return bits.join(" · ");
}

export default function InboxPage() {
  const runner = useRunnerState();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/inbox")
      .then((r) => r.json())
      .then((b) => setItems(b.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load, runner.version]);

  const act = async (id: string, method: "POST" | "DELETE", body?: unknown) => {
    await fetch(`/api/inbox/${id}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    setRunnerState({});
  };

  const list = items ? [...items].reverse() : null;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <p>
            Book ideas sent from your phone through Discord. While any BookStudio tab is open, each one is built by autopilot, one at a time, and saved as a project in this browser. Nothing is published: open each draft in Review &amp; Publish to check it and export the KDP package. Set up the bot under <Link href="/settings">Settings</Link>.
          </p>
        </div>
      </div>
      {runner.building && (
        <div className="notice notice-info" role="status">
          <span className="spinner" /> Building &ldquo;{runner.building}&rdquo;{runner.step ? `: ${runner.step}` : ""}. Keep this tab open until it finishes.
        </div>
      )}
      {error && <div className="notice notice-fail">{error}</div>}
      {!list ? (
        <div className="muted">Loading…</div>
      ) : !list.length ? (
        <div className="empty">No ideas yet. Post one in your Discord ideas channel, for example &ldquo;large print sudoku for seniors, 120 pages&rdquo;.</div>
      ) : (
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Ideas">
          {list.map((it) => (
            <li key={it.id} className="card stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <strong>{it.result?.title ?? it.idea.topic}</strong>
                <span className={`badge ${STATUS[it.status].cls}`}>{STATUS[it.status].label}</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                &ldquo;{it.text.split("\n")[0]}&rdquo; · sent {when(it.createdAt)}
                {details(it) ? ` · ${details(it)}` : ""}
              </div>
              {it.result && (
                <div style={{ fontSize: 13 }}>
                  {it.result.pages} pages · preflight {it.result.preflight.passed}/{it.result.preflight.total}
                  {it.result.preflight.blocking ? `, ${it.result.preflight.blocking} to fix` : ""}
                </div>
              )}
              {it.error && <div className="notice notice-fail">{it.error}</div>}
              <div className="row" style={{ flexWrap: "wrap" }}>
                {it.status === "ready" && it.result && (
                  <Link className="btn btn-sm btn-primary" href={`/projects/${it.result.projectId}#review`}>
                    Open Review &amp; Publish
                  </Link>
                )}
                {(it.status === "failed" || it.status === "ready") && (
                  <button className="btn btn-sm" onClick={() => act(it.id, "POST", { action: "retry" })}>
                    {it.status === "ready" ? "Build again" : "Retry"}
                  </button>
                )}
                {it.status !== "building" && (
                  <button className="btn btn-sm btn-ghost" onClick={() => act(it.id, "DELETE")}>
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
