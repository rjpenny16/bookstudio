"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AUTOPLAN_KEY, type AutoPlanSettings } from "@/lib/kdp/autoplan";
import { FORMAT_KINDS, FORMAT_LABEL } from "@/lib/schema/formats";
import { autoPlanSettings } from "@/lib/storage/autoplan";
import { setValue } from "@/lib/storage/db";

/** Settings: which formats autopilot and the phone inbox turn on for a finished book, planned into free KDP weeks. */
export function AutoPlanCard() {
  const [s, setS] = useState<AutoPlanSettings | null>(null);
  useEffect(() => {
    autoPlanSettings().then(setS);
  }, []);
  const save = (next: AutoPlanSettings) => {
    setS(next);
    void setValue(AUTOPLAN_KEY, next);
  };
  return (
    <div className="card stack" data-testid="autoplan-card">
      <h2 style={{ margin: 0 }}>Release planning</h2>
      <p className="muted" style={{ margin: 0 }}>
        KDP allows 2 new titles per format each week. When autopilot or the phone inbox finishes a book, BookStudio can turn on the formats you publish in and put each into the earliest week with a free slot, shown in the <Link href="/schedule">Release planner</Link>.
      </p>
      {s ? (
        <>
          <label className="check">
            <input type="checkbox" checked={s.enabled} onChange={(e) => save({ ...s, enabled: e.target.checked })} />
            <span>Plan finished books into free KDP weeks</span>
          </label>
          <div className="row" style={{ gap: 16 }} role="group" aria-label="Formats to publish">
            {FORMAT_KINDS.map((k) => (
              <label key={k} className="check">
                <input
                  type="checkbox"
                  disabled={!s.enabled}
                  checked={s.formats.includes(k)}
                  onChange={(e) => save({ ...s, formats: e.target.checked ? FORMAT_KINDS.filter((f) => f === k || s.formats.includes(f)) : s.formats.filter((f) => f !== k) })}
                />
                <span>{FORMAT_LABEL[k]}</span>
              </label>
            ))}
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            Hardcover is skipped when the book can&rsquo;t be one (its trim, standard-color ink, or under 75 pages), and the eBook is skipped for mostly blank notebooks. New formats get a starting price you can change on the book&rsquo;s Export tab.
          </p>
        </>
      ) : (
        <span className="muted">Loading…</span>
      )}
    </div>
  );
}
