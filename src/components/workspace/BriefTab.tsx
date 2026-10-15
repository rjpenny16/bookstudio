"use client";

import { useState } from "react";
import { callAi, isModelOutput, modelRun } from "@/lib/ai/client";
import { findTrim } from "@/lib/kdp/geometry";
import { LISTING } from "@/lib/kdp/rules";
import { BOOK_TYPES, isLowContent, type BookType } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";
import { applyTitle } from "@/lib/agent/regenerateClient";
import type { TitleOption } from "@/lib/schema/project";

export function BriefTab() {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "info" | "fail"; text: string } | null>(null);
  const b = project.brief;
  const replace = useProjectStore((s) => s.replace);

  const chooseTitle = async (o: TitleOption) => {
    setBusy(true);
    setNote(null);
    try {
      const r = await applyTitle(project, o);
      replace(r.project);
      setNote({ kind: "info", text: r.summary });
    } catch (e) {
      setNote({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await callAi("brief", { topic: b.topic || project.name, audience: b.audience, bookType: project.bookType, notes: b.notes, trim: findTrim(project.spec.trimId)?.label ?? "" });
      const o = res.output;
      update((d) => {
        Object.assign(d.brief, { angle: o.angle, audience: o.audience || d.brief.audience, titleIdeas: o.titleIdeas, keywordIdeas: o.keywordIdeas, interiorPlan: o.interiorPlan, coverDirection: o.coverDirection, risks: o.risks });
        if (isModelOutput(res.meta)) d.modelRuns.push(modelRun(res.meta, ["brief"]));
      });
      setNote({ kind: "info", text: `Brief drafted by ${res.meta.provider} (${res.meta.model}). Suggested interior: ${o.generator}, ~${o.pageTarget} pages; cover: ${o.coverTemplate} / ${o.palette}.` });
    } catch (e) {
      setNote({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="split-aside">
      <div className="stack">
        <div className="card stack">
          <div className="row-between">
            <h2 style={{ margin: 0 }}>Publishing brief</h2>
            <button className="btn btn-primary" onClick={generate} disabled={busy || !(b.topic || project.name)}>
              {busy && <span className="spinner" />} Draft brief with AI
            </button>
          </div>
          {note && <div className={`notice notice-${note.kind}`}>{note.text}</div>}
          <div className="field-row">
            <div className="field">
              <label>
                Topic / niche
                <input value={b.topic} placeholder="e.g. gratitude journal for nurses" onChange={(e) => update((d) => void (d.brief.topic = e.target.value))} />
              </label>
            </div>
            <div className="field">
              <label>
                Audience
                <input value={b.audience} placeholder="e.g. busy nurses, gift buyers" onChange={(e) => update((d) => void (d.brief.audience = e.target.value))} />
              </label>
            </div>
            <div className="field">
              <label>
                Book type
                <select value={project.bookType} onChange={(e) => update((d) => void (d.bookType = e.target.value as BookType))}>
                  {BOOK_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="field">
            <label>
              Notes & constraints
              <textarea rows={3} value={b.notes} placeholder="Anything the AI should know: tone, must-have sections, things to avoid" onChange={(e) => update((d) => void (d.brief.notes = e.target.value))} />
            </label>
          </div>
          <div className="field">
            <label>
              Positioning
              <textarea rows={2} value={b.angle} onChange={(e) => update((d) => void (d.brief.angle = e.target.value))} />
            </label>
          </div>
          <div className="field-row">
            <div className="field">
              <label>
                Interior plan
                <textarea rows={3} value={b.interiorPlan} onChange={(e) => update((d) => void (d.brief.interiorPlan = e.target.value))} />
              </label>
            </div>
            <div className="field">
              <label>
                Cover direction
                <textarea rows={3} value={b.coverDirection} onChange={(e) => update((d) => void (d.brief.coverDirection = e.target.value))} />
              </label>
            </div>
          </div>
        </div>
      </div>
      <aside className="stack sticky-aside">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Title ideas</h2>
          {b.titleOptions?.length ? (
            <>
              <ul className="stack" aria-label="Titles named from the content" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>
                {b.titleOptions.map((o) => {
                  const current = o.title === project.metadata.title;
                  return (
                    <li key={o.title} className="stack" style={{ gap: 2 }}>
                      <strong>{o.title}</strong>
                      {o.why && <span className="muted" style={{ fontSize: 12 }}>{o.why}</span>}
                      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} disabled={busy || current} aria-label={current ? `${o.title} is the current title` : `Use the title ${o.title}`} onClick={() => chooseTitle(o)}>
                        {current ? "Current title" : "Use this title"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <span className="field-hint">Named from the finished content. Using one updates the title page and cover too.</span>
            </>
          ) : b.titleIdeas.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Draft a brief to get title ideas.</p>
          ) : (
            <div className="chip-list">
              {b.titleIdeas.map((t) => (
                <button key={t} className="chip" onClick={() => update((d) => void ((d.metadata.title = t), (d.name = t)))} title="Use as title">
                  {t}
                </button>
              ))}
            </div>
          )}
          {!b.titleOptions?.length && <span className="field-hint">Click to use as the book title.</span>}
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Keyword ideas</h2>
          {b.keywordIdeas.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>None yet.</p>
          ) : (
            <div className="chip-list">
              {b.keywordIdeas.map((k) => {
                const used = project.metadata.keywords.includes(k);
                return (
                  <button
                    key={k}
                    className="chip"
                    disabled={used || project.metadata.keywords.filter(Boolean).length >= LISTING.maxKeywords}
                    onClick={() => update((d) => void (d.metadata.keywords = [...d.metadata.keywords.filter(Boolean), k]))}
                    style={used ? { opacity: 0.5 } : undefined}
                  >
                    {used ? "✓ " : "+ "}
                    {k}
                  </button>
                );
              })}
            </div>
          )}
          <span className="field-hint">These are AI suggestions, not search-volume data. Validate them in Research.</span>
        </div>
        {b.risks.length > 0 && (
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Risks to check</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {b.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="card">
          <span className="badge">{isLowContent(project.bookType) ? "Low-content (KDP)" : "Not low-content"}</span>
          <p className="field-hint" style={{ marginTop: 8 }}>
            KDP treats notebooks, journals, planners and log books as low-content. Puzzle and coloring books generally are not.
          </p>
        </div>
      </aside>
    </div>
  );
}
