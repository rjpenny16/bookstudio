"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TITLE_LIMITS } from "@/lib/kdp/limits";
import { addWeeks, isOverdue, nextOpenWeek, openSlots, remaining, usage, weekKey, weekLabel, type EditionRef } from "@/lib/kdp/quota";
import { clearSteps, editionDraft, editionOf, FORMAT_KINDS, FORMAT_LABEL, recordStep, STATUS_LABEL, type KdpStep } from "@/lib/schema/formats";
import type { FormatKind, KdpStatus, ListingMetadata } from "@/lib/schema/project";
import { hardcoverReady } from "@/lib/schema/hardcover";
import { listProjects } from "@/lib/storage/db";
import { useProjectStore } from "@/lib/storage/store";
import { useNow } from "@/lib/util/useNow";

const PLAN_WEEKS = 12;

const STATUS_BADGE: Record<KdpStatus, string> = { "not-started": "", planned: "badge-info", created: "badge-accent", submitted: "badge-warn", live: "badge-pass" };

const NEXT_STEP: Partial<Record<KdpStatus, { step: KdpStep; label: string }>> = {
  "not-started": { step: "created", label: "Created on KDP" },
  planned: { step: "created", label: "Created on KDP" },
  created: { step: "submitted", label: "Submitted" },
  submitted: { step: "live", label: "Live" },
};

/**
 * The formats this book is published in, and where each one is on KDP. KDP limits new
 * titles per format per week, so each format is planned into a week and its steps recorded.
 */
export function FormatsPanel() {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [others, setOthers] = useState<EditionRef[]>([]);

  useEffect(() => {
    listProjects().then((list) =>
      setOthers(list.filter((s) => s.id !== project.id).flatMap((s) => (s.editions ?? []).map((edition) => ({ projectId: s.id, title: s.title || s.name, edition })))),
    );
  }, [project.id]);

  const now = useNow();
  const thisWeek = weekKey(now);
  const mine = useMemo<EditionRef[]>(() => FORMAT_KINDS.map((k) => ({ projectId: project.id, title: project.metadata.title, edition: editionOf(project, k) })), [project]);
  const all = useMemo(() => [...others, ...mine], [others, mine]);
  const weeks = Array.from({ length: PLAN_WEEKS }, (_, i) => addWeeks(thisWeek, i));

  // Recipes must not return a value: immer treats one as a replacement draft.
  const hardcoverOk = hardcoverReady(project).ok;
  const edit = (kind: FormatKind, fn: (e: ReturnType<typeof editionDraft>) => void) =>
    update((d) => {
      fn(editionDraft(d, kind));
    });

  const record = (kind: FormatKind, step: KdpStep) => {
    const left = remaining(usage(all, thisWeek)[kind]);
    if (step === "created" && left.creations === 0 && !confirm(`KDP allows ${TITLE_LIMITS.creationsPerFormatPerWeek} new ${FORMAT_LABEL[kind].toLowerCase()} titles a week, and this week's are used. Record it anyway?`)) return;
    if (step === "submitted" && left.submissions === 0 && !confirm(`KDP allows ${TITLE_LIMITS.submissionsPerFormatPerWeek} first-time ${FORMAT_LABEL[kind].toLowerCase()} submissions a week, and this week's are used. Record it anyway?`)) return;
    edit(kind, (e) => recordStep(e, step));
  };

  return (
    <div className="card stack" id="formats">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Formats</h2>
        <Link className="btn btn-sm btn-ghost" href="/schedule">
          Release planner
        </Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        KDP lets you create {TITLE_LIMITS.creationsPerFormatPerWeek} new titles per format each week, and paperback, hardcover and eBook are counted separately. Publishing this book in more formats uses those other allowances without spending paperback slots. Keep the title, subtitle, author and series the same in every format so Amazon links them on one product page.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Format</th>
              <th>Planned week</th>
              <th>KDP status</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {FORMAT_KINDS.map((kind) => {
              const e = editionOf(project, kind);
              const rest = all.filter((r) => !(r.projectId === project.id && r.edition.kind === kind));
              const next = NEXT_STEP[e.kdp.status];
              const overdue = isOverdue(e, now);
              return (
                <tr key={kind}>
                  <td>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={e.enabled}
                        disabled={kind === "paperback"}
                        onChange={(ev) => edit(kind, (d) => void (d.enabled = ev.target.checked))}
                        aria-label={`Publish as ${FORMAT_LABEL[kind]}`}
                      />
                      <span>{FORMAT_LABEL[kind]}</span>
                    </label>
                    {e.enabled && kind === "hardcover" && !hardcoverOk && (
                      <div className="field-hint" style={{ marginTop: 4, color: "var(--fail)" }}>
                        Not possible as the book is. See Hardcover below.
                      </div>
                    )}
                  </td>
                  <td>
                    {e.enabled && !e.kdp.createdAt ? (
                      <select
                        aria-label={`Planned week for the ${FORMAT_LABEL[kind]}`}
                        value={e.kdp.plannedWeek ?? ""}
                        onChange={(ev) =>
                          edit(kind, (d) => {
                            const w = ev.target.value;
                            if (w) {
                              d.kdp.plannedWeek = w;
                              d.kdp.status = "planned";
                            } else {
                              delete d.kdp.plannedWeek;
                              d.kdp.status = "not-started";
                            }
                          })
                        }
                      >
                        <option value="">Not scheduled</option>
                        {e.kdp.plannedWeek && e.kdp.plannedWeek < thisWeek && <option value={e.kdp.plannedWeek}>{weekLabel(e.kdp.plannedWeek)} (passed)</option>}
                        {weeks.map((w) => {
                          const free = openSlots(usage(rest, w)[kind]);
                          return (
                            <option key={w} value={w}>
                              {weekLabel(w)}
                              {w === thisWeek ? " (this week)" : ""} · {free} free
                            </option>
                          );
                        })}
                      </select>
                    ) : e.enabled ? (
                      <span className="muted">Created {new Date(e.kdp.createdAt!).toLocaleDateString()}</span>
                    ) : (
                      <span className="muted">Off</span>
                    )}
                    {e.enabled && !e.kdp.plannedWeek && !e.kdp.createdAt && (
                      <button className="btn btn-sm btn-ghost" style={{ marginTop: 4 }} onClick={() =>
                          edit(kind, (d) => {
                            d.kdp.plannedWeek = nextOpenWeek(rest, kind, now);
                            d.kdp.status = "planned";
                          })
                        }>
                        Next free week
                      </button>
                    )}
                    {overdue && <div className="field-hint">This week went by. Pick a new one.</div>}
                  </td>
                  <td>
                    {e.enabled && (
                      <div className="stack" style={{ gap: 6 }}>
                        <span className={`badge ${STATUS_BADGE[e.kdp.status]}`}>{STATUS_LABEL[e.kdp.status]}</span>
                        <div className="row" style={{ gap: 4 }}>
                          {next && (
                            <button className="btn btn-sm" onClick={() => record(kind, next.step)} title="Record this step once you've done it on KDP">
                              Mark: {next.label}
                            </button>
                          )}
                          {e.kdp.createdAt && (
                            <button className="btn btn-sm btn-ghost" onClick={() => confirm("Clear the KDP steps recorded for this format?") && edit(kind, clearSteps)}>
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                  <td>{e.enabled && kind !== "paperback" ? <EditionDetails kind={kind} /> : kind === "paperback" ? <span className="muted">ISBN, price and ASIN are on the Listing tab.</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** ISBN, price and ASIN of a non-paperback format. Each format needs its own ISBN. */
function EditionDetails({ kind }: { kind: FormatKind }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const e = editionOf(project, kind);
  const isbn = e.isbn ?? { kind: "none" as const, value: "" };
  const set = (fn: (d: ReturnType<typeof editionDraft>) => void) =>
    update((d) => {
      fn(editionDraft(d, kind));
    });
  const sameIsbn = isbn.kind === "own" && !!isbn.value && isbn.value.replace(/\D/g, "") === project.metadata.isbn.value.replace(/\D/g, "");
  return (
    <div className="stack" style={{ gap: 6, minWidth: 200 }}>
      {kind === "hardcover" && (
        <label className="field">
          ISBN
          <select value={isbn.kind} onChange={(ev) => set((d) => void (d.isbn = { ...isbn, kind: ev.target.value as ListingMetadata["isbn"]["kind"] }))}>
            <option value="none">Not set yet</option>
            <option value="kdp-free">Free KDP ISBN</option>
            <option value="own">My own ISBN</option>
          </select>
        </label>
      )}
      {kind === "hardcover" && isbn.kind === "own" && (
        <input aria-label="Hardcover ISBN" placeholder="978…" value={isbn.value} onChange={(ev) => set((d) => void (d.isbn = { kind: "own", value: ev.target.value }))} />
      )}
      {sameIsbn && <div className="notice notice-fail">This is the paperback&rsquo;s ISBN. Each format needs its own.</div>}
      <label className="field">
        List price (USD)
        <input
          type="number"
          min={0}
          step={0.01}
          value={e.listPriceUsd ?? ""}
          onChange={(ev) => set((d) => void (ev.target.value === "" ? delete d.listPriceUsd : (d.listPriceUsd = Number(ev.target.value))))}
        />
      </label>
      <label className="field">
        ASIN once live
        <input value={e.asin ?? ""} onChange={(ev) => set((d) => void (ev.target.value.trim() ? (d.asin = ev.target.value.trim()) : delete d.asin))} />
      </label>
    </div>
  );
}
