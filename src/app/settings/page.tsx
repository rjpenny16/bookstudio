"use client";

import { useEffect, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { imageStatus, type ImageStatus } from "@/lib/cover/artClient";
import { downloadBlob } from "@/lib/export/package";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { FONTS } from "@/lib/render/fonts";
import { getValue, listProjects, loadProject } from "@/lib/storage/db";

type Capability = "text" | "vision" | "images";
interface Capabilities {
  text: AiStatus;
  vision: { available: boolean | null; detail: string };
  images: ImageStatus;
  envWarnings?: string[];
}
interface TestResult {
  ok: boolean;
  detail: string;
  ms: number;
}

/** One capability: whether it's active, and a live check of the server's connection. */
function CapabilityRow({ id, name, active, detail, badge, onTest, result, testing }: { id: Capability; name: string; active: boolean | null; detail: string; badge: string; onTest: () => void; result?: TestResult; testing: boolean }) {
  return (
    <li className="check-item" aria-label={name}>
      <span className={`check-icon ${active ? "pass" : active === null ? "info" : "warn"}`} aria-label={active ? "Active" : active === null ? "Unknown" : "Not active"}>
        {active ? "✓" : active === null ? "?" : "–"}
      </span>
      <div>
        <strong>{name}</strong> <span className="badge">{badge}</span>
        <div className="muted" style={{ fontSize: 13 }}>
          {detail}
        </div>
        {result && (
          <div className={`notice ${result.ok ? "notice-pass" : "notice-fail"}`} style={{ marginTop: 6, fontSize: 13 }} role="status" data-capability={id}>
            {result.ok ? "Connected" : "Failed"}: {result.detail} ({result.ms} ms)
          </div>
        )}
      </div>
      <div>
        <button className="btn btn-sm" onClick={onTest} disabled={testing}>
          {testing && <span className="spinner" />} Test connection
        </button>
      </div>
    </li>
  );
}

export default function Settings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [images, setImages] = useState<ImageStatus | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [tests, setTests] = useState<Partial<Record<Capability, TestResult>>>({});
  const [testing, setTesting] = useState<Capability | null>(null);
  useEffect(() => {
    fetch("/api/test")
      .then((r) => r.json())
      .then(setCaps)
      .catch(() => setCaps(null));
    aiStatus().then(setStatus).catch(() => setStatus(null));
    imageStatus().then(setImages).catch(() => setImages(null));
    listProjects().then((p) => setCount(p.length));
  }, []);

  const test = async (target: Capability) => {
    setTesting(target);
    try {
      const res = await fetch("/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target }) });
      const body = await res.json();
      setTests((t) => ({ ...t, [target]: res.ok ? body : { ok: false, detail: body.error ?? `HTTP ${res.status}`, ms: 0 } }));
    } catch (e) {
      setTests((t) => ({ ...t, [target]: { ok: false, detail: e instanceof Error ? e.message : String(e), ms: 0 } }));
    } finally {
      setTesting(null);
    }
  };

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
      <div className="card stack" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Capabilities</h2>
        {caps ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Capabilities">
            <CapabilityRow id="text" name="Writing (briefs, content, listings)" active={caps.text.provider !== "offline"} badge={caps.text.provider === "offline" ? "offline templates" : `${caps.text.provider} · ${caps.text.model}`} detail={caps.text.detail} onTest={() => test("text")} result={tests.text} testing={testing === "text"} />
            <CapabilityRow id="vision" name="Vision review (cover, pages, art pick)" active={caps.vision.available} badge={caps.vision.available === false ? "off" : caps.text.model} detail={caps.vision.detail} onTest={() => test("vision")} result={tests.vision} testing={testing === "vision"} />
            <CapabilityRow id="images" name="AI cover art" active={caps.images.configured} badge={caps.images.configured ? `${caps.images.provider} · ${caps.images.model}` : "off"} detail={caps.images.detail} onTest={() => test("images")} result={tests.images} testing={testing === "images"} />
          </ul>
        ) : (
          <span className="muted">Checking…</span>
        )}
        {caps?.envWarnings?.map((w) => (
          <div key={w} className="notice notice-warn" role="alert">
            {w}
          </div>
        ))}
        <p className="field-hint" style={{ margin: 0 }}>
          API keys live only in the server&apos;s environment variables; they are never sent to or stored in this browser. Tests make one tiny request (the cover art test only looks up the model and generates nothing).
        </p>
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
          <h2 style={{ margin: 0 }}>Cover art</h2>
          {images ? (
            <>
              <div className="row">
                <span className={`badge ${images.configured ? "badge-pass" : "badge-warn"}`}>{images.provider}</span>
                {images.model && <code>{images.model}</code>}
              </div>
              <p className="muted" style={{ margin: 0 }}>{images.detail}</p>
            </>
          ) : (
            <span className="muted">Checking…</span>
          )}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            <li><code>OPENAI_API_KEY</code>: generate cover art with the OpenAI Images API (default model <code>gpt-image-2</code>, override with <code>OPENAI_IMAGE_MODEL</code>; <code>OPENAI_IMAGE_QUALITY</code> defaults to <code>high</code>).</li>
            <li><code>IMAGE_PROVIDER=codex</code>: generate cover art with your ChatGPT subscription instead of an API key, through the <a href="https://github.com/openai/codex">codex CLI</a> and the bundled gpt-image-bridge script. Install codex on the server machine and run <code>codex login</code>. No per-image billing, but each image takes about 2 to 6 minutes and counts against your ChatGPT usage limits. On Windows it also needs <a href="https://git-scm.com">Git for Windows</a> (for its bash); set <code>CODEX_BASH</code> if it isn&apos;t under Program Files.</li>
            <li>gpt-image-2 is asked for art at 300 DPI for the cover size (up to its 8.3 MP limit). Older models return at most 1536 px, which is upscaled; preflight still reports the real resolution.</li>
            <li>Generated images are marked AI-generated, so the KDP image disclosure is pre-filled.</li>
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
