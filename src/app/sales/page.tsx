"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { aggregate, importSalesCsv, SAMPLE_SALES, type SaleRow } from "@/lib/research/sales";
import { getValue, listProjects, setValue, type ProjectSummary } from "@/lib/storage/db";

const KEY = "sales:rows";
const money = (r: Record<string, number>) => Object.entries(r).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" · ") || "0.00";

export default function Sales() {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [msg, setMsg] = useState<{ kind: "pass" | "fail"; text: string } | null>(null);

  useEffect(() => {
    getValue<SaleRow[]>(KEY).then((r) => setRows(r ?? []));
    listProjects().then(setProjects);
  }, []);

  const save = (next: SaleRow[]) => {
    setRows(next);
    void setValue(KEY, next);
  };
  const agg = useMemo(() => aggregate(rows ?? []), [rows]);
  const maxUnits = Math.max(1, ...agg.months.map((m) => m.units));
  const projectFor = (title: string) => projects.find((p) => (p.title || p.name).toLowerCase() === title.toLowerCase());

  const importText = (text: string) => {
    try {
      const r = importSalesCsv(text);
      save([...(rows ?? []), ...r.rows]);
      setMsg({ kind: "pass", text: `Imported ${r.rows.length} rows.` });
    } catch (e) {
      setMsg({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sales reports</h1>
          <p>Import royalty reports you download from KDP (saved as CSV). Data stays in this browser. Titles that match a project are linked back to it so you can see which books and niches perform.</p>
        </div>
        <div className="row">
          <label className="btn btn-primary" style={{ cursor: "pointer" }}>
            Import CSV…
            <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) importText(await f.text()); e.target.value = ""; }} />
          </label>
          <button className="btn" onClick={() => importText(SAMPLE_SALES)}>Load sample</button>
          {!!rows?.length && <button className="btn btn-ghost btn-danger" onClick={() => confirm("Remove all imported sales rows?") && save([])}>Clear</button>}
        </div>
      </div>
      {msg && <div className={`notice notice-${msg.kind}`} style={{ marginBottom: 14 }}>{msg.text}</div>}
      {!rows ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="empty">No sales imported yet. Expected columns: Royalty Date, Title, ASIN/ISBN, Marketplace, Net Units Sold, Royalty, Currency.</div>
      ) : (
        <div className="stack">
          <div className="grid grid-3">
            <div className="card stat"><span className="stat-label">Units (observed)</span><span className="stat-value">{agg.totalUnits.toLocaleString()}</span></div>
            <div className="card stat"><span className="stat-label">Royalties</span><span className="stat-value" style={{ fontSize: 18 }}>{money(agg.totalRoyalty)}</span></div>
            <div className="card stat"><span className="stat-label">Titles</span><span className="stat-value">{agg.titles.length}</span></div>
          </div>
          <div className="card">
            <h2>Units by month</h2>
            <table className="table">
              <tbody>
                {agg.months.map((m) => (
                  <tr key={m.month}>
                    <td style={{ width: 90 }}>{m.month}</td>
                    <td><div className="bar" style={{ width: `${(m.units / maxUnits) * 100}%`, minWidth: 2 }} role="img" aria-label={`${m.units} units`} /></td>
                    <td className="num" style={{ width: 70 }}>{m.units}</td>
                    <td className="num" style={{ width: 180 }}>{money(m.royalty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <h2>By title</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Title</th><th className="num">Units</th><th className="num">Royalties</th><th>Project</th></tr></thead>
                <tbody>
                  {agg.titles.map((t) => {
                    const p = projectFor(t.title);
                    return (
                      <tr key={t.title}>
                        <td>{t.title}<div className="muted" style={{ fontSize: 11 }}>{t.asin}</div></td>
                        <td className="num">{t.units}</td>
                        <td className="num">{money(t.royalty)}</td>
                        <td>{p ? <Link href={`/projects/${p.id}`}>Open project</Link> : <span className="muted">not linked</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
