"use client";

import Link from "next/link";
import { TITLE_LIMITS } from "@/lib/kdp/limits";
import { nextResetUtc, remaining, usage, weekKey, type EditionRef } from "@/lib/kdp/quota";
import { FORMAT_KINDS, FORMAT_LABEL } from "@/lib/schema/formats";
import { useNow } from "@/lib/util/useNow";

function resetsIn(now: number): string {
  const hours = Math.ceil((nextResetUtc(now).getTime() - now) / 3_600_000);
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} h`;
}

/** This week's KDP allowance per format: titles created and submitted out of the weekly limit. */
export function QuotaStrip({ refs, plannerLink = true }: { refs: EditionRef[]; plannerLink?: boolean }) {
  const now = useNow();
  const u = usage(refs, weekKey(now));
  return (
    <div className="card stack" style={{ marginBottom: 16 }} aria-label="KDP weekly title allowance">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>This week on KDP</h2>
        <span className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 12 }} title="KDP's weekly limits reset every Sunday at 00:00 UTC">
            Resets in {resetsIn(now)}
          </span>
          {plannerLink && (
            <Link className="btn btn-sm" href="/schedule">
              Release planner
            </Link>
          )}
        </span>
      </div>
      <div className="grid grid-3">
        {FORMAT_KINDS.map((k) => {
          const f = u[k];
          const r = remaining(f);
          const full = r.creations === 0;
          return (
            <div key={k} className="stat">
              <span className="stat-label">{FORMAT_LABEL[k]}</span>
              <span className="stat-value">
                {r.creations} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>of {TITLE_LIMITS.creationsPerFormatPerWeek} new titles left</span>
              </span>
              <span className="stat-sub">
                {f.submitted} of {TITLE_LIMITS.submissionsPerFormatPerWeek} submissions used{f.planned ? ` · ${f.planned} planned` : ""}
                {full && <span className="badge badge-warn" style={{ marginLeft: 6 }}>full</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
