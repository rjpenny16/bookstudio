"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { QuotaStrip } from "@/components/QuotaStrip";
import { TITLE_LIMITS } from "@/lib/kdp/limits";
import { addWeeks, autoSchedule, isBacklog, isOverdue, openSlots, refsFromSummaries, usage, weekItems, weekKey, weekLabel, type EditionRef } from "@/lib/kdp/quota";
import { editionDraft, FORMAT_KINDS, FORMAT_LABEL, STATUS_LABEL } from "@/lib/schema/formats";
import type { FormatKind } from "@/lib/schema/project";
import { listProjects, loadProject, saveProject, type ProjectSummary } from "@/lib/storage/db";
import { useNow } from "@/lib/util/useNow";

const SHOW_WEEKS = 8;

/** Plan (or unplan) editions into weeks: [projectId, kind, week or null]. */
async function plan(changes: { projectId: string; kind: FormatKind; week: string | null }[]): Promise<void> {
  const byProject = new Map<string, typeof changes>();
  for (const c of changes) byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c]);
  for (const [id, list] of byProject) {
    const p = await loadProject(id);
    if (!p) continue;
    for (const c of list) {
      const e = editionDraft(p, c.kind);
      if (e.kdp.createdAt) continue;
      if (c.week) {
        e.kdp.plannedWeek = c.week;
        e.kdp.status = "planned";
      } else {
        delete e.kdp.plannedWeek;
        e.kdp.status = "not-started";
      }
    }
    p.updatedAt = new Date().toISOString();
    await saveProject(p);
  }
}

export default function Schedule() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => listProjects().then(setProjects);
  useEffect(() => {
    refresh();
  }, []);

  const now = useNow();
  const thisWeek = weekKey(now);
  const weeks = Array.from({ length: SHOW_WEEKS }, (_, i) => addWeeks(thisWeek, i));
  const refs = useMemo(() => refsFromSummaries(projects ?? []), [projects]);
  // Oldest-edited books first: they have usually been finished longest.
  const backlog = useMemo(() => {
    const order = new Map((projects ?? []).map((p) => [p.id, p.updatedAt]));
    return refs.filter((r) => isBacklog(r.edition, now)).sort((a, b) => (order.get(a.projectId) ?? "").localeCompare(order.get(b.projectId) ?? ""));
  }, [refs, projects, now]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const autoPlan = () => {
    const order = new Map((projects ?? []).map((p) => [p.id, p.updatedAt]));
    const sorted = [...refs].sort((a, b) => (order.get(a.projectId) ?? "").localeCompare(order.get(b.projectId) ?? ""));
    return run(() => plan(autoSchedule(sorted, now)));
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Release planner</h1>
          <p>
            KDP lets you create {TITLE_LIMITS.creationsPerFormatPerWeek} new titles and submit {TITLE_LIMITS.submissionsPerFormatPerWeek} for the first time per format each week, resetting Sunday 00:00 UTC. BookStudio can build books faster than that, so plan which book and format goes out in which week. Record each step from the book&rsquo;s Export tab once you&rsquo;ve done it on KDP.
          </p>
        </div>
      </div>
      {projects === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <QuotaStrip refs={refs} plannerLink={false} />
          <div className="card stack" style={{ marginBottom: 16 }}>
            <div className="row-between">
              <h2 style={{ margin: 0 }}>
                Waiting for a week<span className="muted" style={{ fontWeight: 500 }}> · {backlog.length}</span>
              </h2>
              <button className="btn btn-primary btn-sm" disabled={busy || !backlog.length} onClick={autoPlan} title="Put each waiting format into the earliest week with a free slot, oldest books first">
                Plan all into free weeks
              </button>
            </div>
            {backlog.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Every format you&rsquo;ve turned on has a week. Turn on hardcover or eBook in a book&rsquo;s Export tab to use those allowances.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Book</th>
                      <th>Format</th>
                      <th>Week</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backlog.map((r) => (
                      <tr key={`${r.projectId}-${r.edition.kind}`}>
                        <td>
                          <Link href={`/projects/${r.projectId}#export`}>{r.title || "Untitled"}</Link>
                          {isOverdue(r.edition, now) && <div className="field-hint">Was planned for {weekLabel(r.edition.kdp.plannedWeek!)}</div>}
                        </td>
                        <td>{FORMAT_LABEL[r.edition.kind]}</td>
                        <td>
                          <WeekSelect refs={refs} self={r} weeks={weeks} disabled={busy} onPick={(week) => run(() => plan([{ projectId: r.projectId, kind: r.edition.kind, week }]))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Weeks</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Week (from Sunday, UTC)</th>
                    {FORMAT_KINDS.map((k) => (
                      <th key={k}>{FORMAT_LABEL[k]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => {
                    const u = usage(refs, w);
                    return (
                      <tr key={w}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {weekLabel(w)}
                          {w === thisWeek && <div className="badge badge-accent">this week</div>}
                        </td>
                        {FORMAT_KINDS.map((k) => {
                          const items = weekItems(refs, w, k);
                          const free = openSlots(u[k]);
                          return (
                            <td key={k}>
                              <div className="stack" style={{ gap: 4 }}>
                                {items.map((r) => (
                                  <div key={r.projectId} className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                    <Link href={`/projects/${r.projectId}#export`}>{r.title || "Untitled"}</Link>
                                    <span className="badge">{STATUS_LABEL[r.edition.kdp.status]}</span>
                                    {r.edition.kdp.status === "planned" && (
                                      <button className="btn btn-sm btn-ghost" disabled={busy} aria-label={`Unplan ${r.title} ${FORMAT_LABEL[k]}`} onClick={() => run(() => plan([{ projectId: r.projectId, kind: k, week: null }]))}>
                                        Unplan
                                      </button>
                                    )}
                                  </div>
                                ))}
                                {items.length > TITLE_LIMITS.creationsPerFormatPerWeek && <span className="badge badge-fail">over the limit</span>}
                                {free > 0 && (
                                  <span className="muted" style={{ fontSize: 12 }}>
                                    {free} free slot{free === 1 ? "" : "s"}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WeekSelect({ refs, self, weeks, disabled, onPick }: { refs: EditionRef[]; self: EditionRef; weeks: string[]; disabled: boolean; onPick: (week: string) => void }) {
  const rest = refs.filter((r) => r !== self);
  return (
    <select aria-label={`Week for ${self.title} ${FORMAT_LABEL[self.edition.kind]}`} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">Pick a week</option>
      {weeks.map((w) => {
        const free = openSlots(usage(rest, w)[self.edition.kind]);
        return (
          <option key={w} value={w} disabled={free === 0}>
            {weekLabel(w)} · {free} free
          </option>
        );
      })}
    </select>
  );
}
