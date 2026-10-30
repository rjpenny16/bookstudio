"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { fetchRankHistory, marketStatus } from "@/lib/market/client";
import type { MarketStatus } from "@/lib/market/types";
import { estimateMonthlySales } from "@/lib/research";
import { calibrationPoints, CURVE_KEY, fitSalesCurve, MIN_POINTS, type SalesCurve } from "@/lib/research/calibrate";
import { aggregate, asinOf, importSalesCsv, projectForSale, SAMPLE_SALES, type SaleRow } from "@/lib/research/sales";
import { deleteValue, getValue, listProjects, setValue, type ProjectSummary } from "@/lib/storage/db";

const KEY = "sales:rows";
const money = (r: Record<string, number>) => Object.entries(r).map(([c, v]) => `${v.toFixed(2)} ${c}`).join(" · ") || "0.00";

export default function Sales() {
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [msg, setMsg] = useState<{ kind: "pass" | "fail"; text: string } | null>(null);
  const [curve, setCurve] = useState<SalesCurve | null>(null);
  const [market, setMarket] = useState<MarketStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getValue<SaleRow[]>(KEY).then((r) => setRows(r ?? []));
    listProjects().then(setProjects);
    getValue<SalesCurve>(CURVE_KEY).then((c) => setCurve(c ?? null));
    marketStatus().then(setMarket).catch(() => setMarket(null));
  }, []);

  const save = (next: SaleRow[]) => {
    setRows(next);
    void setValue(KEY, next);
  };
  const agg = useMemo(() => aggregate(rows ?? []), [rows]);
  const maxUnits = Math.max(1, ...agg.months.map((m) => m.units));
  const projectFor = (t: { title: string; asin: string }) => projectForSale(t, projects);

  /** Fit the rank-to-sales curve to these books: their US sales by month against their Keepa rank history. */
  const calibrate = async () => {
    if (!rows) return;
    setBusy(true);
    setMsg(null);
    try {
      const us = rows.filter((r) => /^amazon\.com$/i.test(r.marketplace.trim())).map((r) => asinOf(r.asin));
      const asins = [...new Set([...us, ...projects.map((p) => p.asin ?? "")].filter(Boolean))].slice(0, 100);
      if (!asins.length) throw new Error("No ASINs to look up: the reports need an ASIN/ISBN column with Amazon.com sales.");
      const books = await fetchRankHistory(asins);
      const points = calibrationPoints(rows, books);
      const c = fitSalesCurve(points);
      if (!c) {
        setMsg({ kind: "fail", text: `Found ${points.length} book-month(s) with both US sales and a sales rank; at least ${MIN_POINTS} are needed for a fit that means anything. Import more months of reports and try again.` });
        return;
      }
      await setValue(CURVE_KEY, c);
      setCurve(c);
      setMsg({ kind: "pass", text: `Fitted from ${c.n} book-months across ${c.books} book(s). Research estimates now use it.` });
    } catch (e) {
      setMsg({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

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
          {market?.products.configured && !!rows?.length && (
            <button className="btn" onClick={calibrate} disabled={busy} title="Look up your books' sales rank history and fit how many copies a rank means">
              {busy && <span className="spinner" />} Calibrate sales estimates
            </button>
          )}
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
          <div className="card stack" data-testid="sales-curve">
            <h2 style={{ margin: 0 }}>What a sales rank means</h2>
            {curve ? (
              <>
                <p className="muted" style={{ margin: 0 }}>
                  Fitted to your books ({curve.n} book-months across {curve.books} book(s), R² {curve.r2.toFixed(2)}, {curve.fittedAt.slice(0, 10)}). Research boards use it in place of the generic curve.
                </p>
                <table className="table">
                  <thead><tr><th>Best Sellers Rank</th><th className="num">Your books (est.)</th><th className="num">Generic curve</th></tr></thead>
                  <tbody>
                    {[5000, 20000, 100000, 500000].map((bsr) => {
                      const mine = estimateMonthlySales(bsr, curve)!;
                      return (
                        <tr key={bsr}>
                          <td>{bsr.toLocaleString()}</td>
                          <td className="num">~{mine.value.toLocaleString()} a month <span className="muted" style={{ fontSize: 11 }}>({mine.interval95[0].toLocaleString()}–{mine.interval95[1].toLocaleString()})</span></td>
                          <td className="num">~{estimateMonthlySales(bsr)!.value.toLocaleString()} a month</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div>
                  <button className="btn btn-sm btn-ghost" onClick={() => void deleteValue(CURVE_KEY).then(() => setCurve(null))}>Go back to the generic curve</button>
                </div>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Copies sold are estimated from a sales rank with a generic curve (100,000 ÷ rank a day) until it is fitted to your own books.{" "}
                {market?.products.configured ? "Use Calibrate sales estimates above: it reads your books' rank history from Keepa and lines it up with these reports." : "Set up Keepa under Settings → Market data to fit it to your books' rank history and these reports."}
              </p>
            )}
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
                    const p = projectFor(t);
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
