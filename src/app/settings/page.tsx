"use client";

import { useEffect, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { downloadBlob } from "@/lib/export/package";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { FONTS } from "@/lib/render/fonts";
import { getValue, listProjects, loadProject } from "@/lib/storage/db";

export default function Settings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    aiStatus().then(setStatus).catch(() => setStatus(null));
    listProjects().then((p) => setCount(p.length));
  }, []);

  const exportAll = async () => {
    const summaries = await listProjects();
    const projects = await Promise.all(summaries.map((s) => loadProject(s.id)));
    const boards = await getValue("research:boards");
    const sales = await getValue("sales:rows");
    downloadBlob(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), projects, researchBoards: boards ?? [], sales: sales ?? [] })], { type: "application/json" }), "bookstudio-workspace.json");
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>BookStudio is local-first: projects, research and sales imports live in this browser&apos;s IndexedDB. Only AI requests go to the server, and from there to the model provider you configure.</p>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>AI provider</h2>
          {status ? (
            <>
              <div className="row">
                <span className={`badge ${status.provider === "offline" ? "badge-warn" : "badge-pass"}`}>{status.provider}</span>
                <code>{status.model}</code>
              </div>
              <p className="muted" style={{ margin: 0 }}>{status.detail}</p>
            </>
          ) : (
            <span className="muted">Checking…</span>
          )}
          <p style={{ margin: 0, fontSize: 13 }}>Configure on the server with environment variables (see <code>.env.example</code>):</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            <li><code>ANTHROPIC_API_KEY</code>: Claude via the Anthropic API (default model <code>claude-opus-5-5</code>, override with <code>ANTHROPIC_MODEL</code>).</li>
            <li><code>AI_PROVIDER=ollama</code> with <code>OLLAMA_BASE_URL</code> and <code>OLLAMA_MODEL</code>: self-hosted open-weight models.</li>
            <li><code>AI_PROVIDER=offline</code>: deterministic templates only, no model calls.</li>
          </ul>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Your data</h2>
          <p className="muted" style={{ margin: 0 }}>{count ?? "…"} project(s) stored in this browser. Clearing site data deletes them, so export regularly.</p>
          <button className="btn" onClick={exportAll}>Export entire workspace (.json)</button>
          <p className="field-hint" style={{ margin: 0 }}>Single projects can be exported from their Export tab and imported from the Projects page.</p>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Marketplace rules</h2>
          <p className="muted" style={{ margin: 0 }}>Rule set <code>{RULES_VERSION}</code> (Amazon KDP paperback). Trim sizes, spine factors, margins, printing costs and listing limits live in <code>src/lib/kdp/rules.ts</code> so they can be updated without touching the editor.</p>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Bundled fonts</h2>
          <p className="muted" style={{ margin: 0 }}>All fonts are SIL Open Font License 1.1, embedded in every PDF and listed in each package&apos;s <code>licenses.json</code>.</p>
          <div className="chip-list">
            {FONTS.map((f) => (
              <span key={f.family} className="chip" style={{ fontFamily: `"${f.family}"` }}>{f.label}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
