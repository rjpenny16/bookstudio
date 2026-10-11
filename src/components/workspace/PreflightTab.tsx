"use client";

import { useState } from "react";
import type { Issue, PreflightReport } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { useProjectStore } from "@/lib/storage/store";

const ICON = { pass: "✓", info: "i", warn: "!", fail: "✕" } as const;
const WORD = { pass: "Passed", info: "Info", warn: "Warning", fail: "Failed" } as const;

export function PreflightTab({ report, onGo }: { report: PreflightReport; onGo: (i: Issue) => void }) {
  const project = useProjectStore((s) => s.project)!;
  const replace = useProjectStore((s) => s.replace);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pct = Math.round((report.passed / report.total) * 100);

  return (
    <div className="split-aside">
      <div className="card">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>KDP preflight</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            Rules {report.rulesVersion}
          </span>
        </div>
        <div role="list">
          {report.checks.map((c) => {
            const open = expanded[c.id] ?? c.status === "fail";
            const shown = open ? c.issues : [];
            return (
              <div key={c.id} className="check-item" role="listitem">
                <span className={`check-icon ${c.status}`} aria-label={WORD[c.status]}>
                  {ICON[c.status]}
                </span>
                <div>
                  <strong>{c.title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {c.summary}
                  </div>
                  {c.issues.length > 0 && (
                    <button className="btn btn-ghost btn-sm" style={{ padding: 0, height: 22 }} aria-expanded={open} onClick={() => setExpanded((e) => ({ ...e, [c.id]: !open }))}>
                      {open ? "Hide" : "Show"} {c.issues.length} detail{c.issues.length === 1 ? "" : "s"}
                    </button>
                  )}
                  {shown.length > 0 && (
                    <ul className="issue-list">
                      {shown.map((i, k) => (
                        <li key={k}>
                          {i.pageIndex !== undefined || i.elementId || i.area === "listing" ? (
                            <button onClick={() => onGo(i)}>{i.message}</button>
                          ) : (
                            i.message
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  {c.fix && (
                    <button className="btn btn-sm" onClick={() => replace(applyFix(project, c.fix!.id))}>
                      {c.fix.label}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <aside className="stack sticky-aside">
        <div className="card row" style={{ gap: 16 }}>
          <div className="score-ring" style={{ ["--p" as string]: pct }} role="img" aria-label={`${report.passed} of ${report.total} checks passed`}>
            <span>
              {report.passed}/{report.total}
            </span>
          </div>
          <div>
            <strong>{report.blocking ? `${report.blocking} blocking issue${report.blocking > 1 ? "s" : ""}` : "Ready for export"}</strong>
            <div className="muted" style={{ fontSize: 13 }}>
              {report.blocking ? "Fix these before uploading to KDP." : "Upload is still your call: check KDP's previewer."}
            </div>
          </div>
        </div>
        <div className="card">
          <h3>How preflight works</h3>
          <p className="muted" style={{ fontSize: 13 }}>
            Checks run continuously against a versioned KDP rule set: trim, bleed, gutter by page count, cover spine and safe zones, barcode area, image DPI, font embedding, blank-page runs, listing limits, ISBN rules for low-content books and AI disclosure.
          </p>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            One-click fixes are deterministic edits you can undo. Confirming AI disclosure always stays with you.
          </p>
        </div>
      </aside>
    </div>
  );
}
