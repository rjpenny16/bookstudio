"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { callAi } from "@/lib/ai/client";
import { fetchSnapshot, marketConfigured, marketStatus } from "@/lib/market/client";
import type { MarketStatus } from "@/lib/market/types";
import { estimateMonthlySales, importObservationsCsv, newBoard, observationsFromMarket, SAMPLE_CSV, summarizeNiche, titlePhrases, type Estimate, type ResearchBoard } from "@/lib/research";
import { CURVE_KEY, type SalesCurve } from "@/lib/research/calibrate";
import { getValue, setValue } from "@/lib/storage/db";

const KEY = "research:boards";

function EstimateCell({ e }: { e: Estimate | null }) {
  if (!e) return <span className="muted">n/a</span>;
  return (
    <span title={`${e.method}; 95% interval ${e.interval95[0]}–${e.interval95[1]}; confidence ${e.confidence}`}>
      ~{e.value.toLocaleString()} <span className="badge badge-warn">est.</span>
      <div className="muted" style={{ fontSize: 11 }}>
        {e.interval95[0].toLocaleString()}–{e.interval95[1].toLocaleString()}
      </div>
    </span>
  );
}

export default function Research() {
  const [boards, setBoards] = useState<ResearchBoard[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ kind: "info" | "fail" | "pass"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [curve, setCurve] = useState<SalesCurve | null>(null);
  const [market, setMarket] = useState<MarketStatus | null>(null);

  useEffect(() => {
    getValue<ResearchBoard[]>(KEY).then((b) => {
      setBoards(b ?? []);
      if (b?.length) setActiveId(b[0].id);
    });
    getValue<SalesCurve>(CURVE_KEY).then((c) => setCurve(c ?? null));
    marketStatus().then(setMarket).catch(() => setMarket(null));
  }, []);

  const persist = (next: ResearchBoard[]) => {
    setBoards(next);
    void setValue(KEY, next);
  };
  const board = boards?.find((b) => b.id === activeId) ?? null;
  const patch = (fn: (b: ResearchBoard) => ResearchBoard) => boards && board && persist(boards.map((b) => (b.id === board.id ? { ...fn(b), updatedAt: new Date().toISOString() } : b)));
  const summary = useMemo(() => (board ? summarizeNiche(board.observations, curve) : null), [board, curve]);
  const phrases = useMemo(() => (board ? titlePhrases(board.observations) : []), [board]);

  const importText = (text: string, source: string) => {
    try {
      const r = importObservationsCsv(text, source);
      patch((b) => ({ ...b, observations: [...b.observations, ...r.observations] }));
      setMsg({ kind: "pass", text: `Imported ${r.observations.length} rows (${Object.entries(r.mapped).map(([k, v]) => `${k}←"${v}"`).join(", ")})${r.skipped ? `, skipped ${r.skipped}` : ""}.` });
      setPaste("");
    } catch (e) {
      setMsg({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const expandKeywords = async () => {
    if (!board) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await callAi("keywords", { topic: board.topic || board.name, seeds: phrases.slice(0, 10).map((p) => p.phrase), observedTitles: board.observations.slice(0, 40).map((o) => o.title) });
      patch((b) => ({ ...b, keywordClusters: r.output.clusters, keywordSource: `${r.meta.provider} (${r.meta.model}): ${r.output.notes}` }));
    } catch (e) {
      setMsg({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fetchMarket = async (fresh = false) => {
    if (!board) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetchSnapshot(board.topic || board.name, { fresh });
      const s = r.snapshot;
      const found = observationsFromMarket(s.products, s.source, s.fetchedAt);
      patch((b) => ({
        ...b,
        observations: [...b.observations.filter((o) => !found.some((f) => f.asin && f.asin === o.asin)), ...found],
        ...(s.keywords.length ? { keywordClusters: [{ intent: "What shoppers search on Amazon (monthly searches)", keywords: s.keywords.slice(0, 30).map((k) => (k.volume === null ? k.keyword : `${k.keyword} (${k.volume.toLocaleString()})`)) }, ...b.keywordClusters.filter((c) => !c.intent.startsWith("What shoppers search"))], keywordSource: `Observed search volumes from ${s.source}, ${s.fetchedAt.slice(0, 10)}` } : {}),
      }));
      setMsg({ kind: r.warnings.length ? "info" : "pass", text: `${found.length} competing books and ${s.keywords.length} search phrases from ${s.source}${r.cached ? " (fetched within the last week, so no new charge)" : ""}.${r.warnings.length ? ` ${r.warnings.join(" ")}` : ""}` });
    } catch (e) {
      setMsg({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Research boards</h1>
          <p>
            Bring your own data: CSV exports you are allowed to use (your own research, licensed feeds, manual notes). BookStudio does not scrape marketplaces. Observed values and model estimates are always labelled separately.
          </p>
        </div>
      </div>
      <div className="list-split">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Boards</h2>
          {boards?.map((b) => (
            <button key={b.id} className="layer-item" aria-current={b.id === activeId} onClick={() => setActiveId(b.id)}>
              <span style={{ flex: 1 }}>{b.name}</span>
              <span className="counter">{b.observations.length}</span>
            </button>
          ))}
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim() || !boards) return;
              const b = newBoard(newName.trim(), newName.trim());
              persist([b, ...boards]);
              setActiveId(b.id);
              setNewName("");
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New board, e.g. nurse journals" aria-label="New board name" />
            <button className="btn btn-sm" type="submit" disabled={!newName.trim()}>
              Create board
            </button>
          </form>
        </div>

        {!board ? (
          <div className="empty">Create a board to start collecting observations for a niche.</div>
        ) : (
          <div className="stack">
            <div className="card stack">
              <div className="row-between">
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label>
                    Niche / topic
                    <input value={board.topic} onChange={(e) => patch((b) => ({ ...b, topic: e.target.value }))} />
                  </label>
                </div>
                <div className="row" style={{ alignSelf: "end" }}>
                  <Link className="btn btn-primary" href={`/autopilot?topic=${encodeURIComponent(board.topic || board.name)}&notes=${encodeURIComponent(phrases.slice(0, 8).map((p) => p.phrase).join(", "))}`}>
                    Start a book from this niche
                  </Link>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      if (!boards || !confirm(`Delete board "${board.name}"?`)) return;
                      const rest = boards.filter((b) => b.id !== board.id);
                      persist(rest);
                      setActiveId(rest[0]?.id ?? null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="row">
                {marketConfigured(market) && (
                  <button className="btn btn-sm btn-primary" onClick={() => fetchMarket()} disabled={busy || !(board.topic || board.name).trim()} title="Search Amazon through your market data provider for this niche">
                    {busy && <span className="spinner" />} Fetch competing books
                  </button>
                )}
                <label className="btn btn-sm" style={{ cursor: "pointer" }}>
                  Import CSV…
                  <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) importText(await f.text(), f.name); e.target.value = ""; }} />
                </label>
                <button className="btn btn-sm" onClick={() => importText(SAMPLE_CSV, "sample data (fictional)")}>
                  Load sample data
                </button>
                {board.observations.length > 0 && (
                  <button className="btn btn-sm btn-ghost" onClick={() => patch((b) => ({ ...b, observations: [] }))}>
                    Clear observations
                  </button>
                )}
              </div>
              <details>
                <summary className="muted" style={{ cursor: "pointer" }}>
                  Paste CSV instead
                </summary>
                <div className="stack" style={{ marginTop: 8 }}>
                  <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="title,bsr,price,reviews,…" aria-label="CSV text" />
                  <button className="btn btn-sm" disabled={!paste.trim()} onClick={() => importText(paste, "pasted")}>
                    Import pasted rows
                  </button>
                </div>
              </details>
              <p className="field-hint" style={{ margin: 0 }}>
                Recognised columns: title, asin/isbn, author, bsr/sales rank, price, reviews, rating, pages, category, observed_at. Only title is required.
              </p>
              {msg && <div className={`notice notice-${msg.kind}`}>{msg.text}</div>}
            </div>

            {summary && summary.count > 0 && (
              <div className="card stack">
                <h2 style={{ margin: 0 }}>Niche summary</h2>
                <div className="grid grid-4">
                  <div className="stat">
                    <span className="stat-label">Opportunity</span>
                    <span className="stat-value">{summary.opportunity}/100</span>
                    <span className="stat-sub">
                      demand {summary.demand} · competition {summary.competition}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Median BSR (observed)</span>
                    <span className="stat-value">{summary.medianBsr ? Math.round(summary.medianBsr).toLocaleString() : "n/a"}</span>
                    <span className="stat-sub">{summary.count} titles</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Units / month (all titles)</span>
                    <span className="stat-value">
                      <EstimateCell e={summary.estMonthlyUnits} />
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Revenue / month</span>
                    <span className="stat-value">{summary.estMonthlyRevenue ? <>~${summary.estMonthlyRevenue.value.toLocaleString()} <span className="badge badge-warn">est.</span></> : "n/a"}</span>
                    <span className="stat-sub">median price {summary.medianPrice ? `$${summary.medianPrice.toFixed(2)}` : "n/a"}</span>
                  </div>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-2)" }}>
                  {summary.explanation.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}

            {board.observations.length > 0 && (
              <div className="card">
                <h2>Observations</h2>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th className="num">BSR</th>
                        <th className="num">Price</th>
                        <th className="num">Reviews</th>
                        <th className="num">Est. sales / mo</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.observations.map((o) => (
                        <tr key={o.id}>
                          <td>
                            {o.title}
                            <div className="muted" style={{ fontSize: 11 }}>
                              {[o.author, o.asin, o.category].filter(Boolean).join(" · ")}
                            </div>
                          </td>
                          <td className="num">{o.bsr?.toLocaleString() ?? "n/a"}</td>
                          <td className="num">{o.price !== null ? `$${o.price.toFixed(2)}` : "n/a"}</td>
                          <td className="num">{o.reviews ?? "n/a"}</td>
                          <td className="num">
                            <EstimateCell e={estimateMonthlySales(o.bsr, curve)} />
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {o.source}
                            <div>{o.observedAt.slice(0, 10)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid grid-2">
              <div className="card stack">
                <h2 style={{ margin: 0 }}>Phrases in competing titles</h2>
                <span className="field-hint">Observed frequency across imported titles, not search volume.</span>
                {phrases.length === 0 ? (
                  <span className="muted">Import titles to see recurring phrases.</span>
                ) : (
                  <table className="table">
                    <tbody>
                      {phrases.map((p) => (
                        <tr key={p.phrase}>
                          <td>{p.phrase}</td>
                          <td style={{ width: "40%" }}>
                            <div className="bar" style={{ width: `${(p.titles / phrases[0].titles) * 100}%` }} />
                          </td>
                          <td className="num">{p.titles}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card stack">
                <div className="row-between">
                  <h2 style={{ margin: 0 }}>Keyword ideas</h2>
                  <button className="btn btn-sm btn-primary" onClick={expandKeywords} disabled={busy}>
                    {busy && <span className="spinner" />} Suggest with AI
                  </button>
                </div>
                <span className="field-hint">AI suggestions to validate; they carry no search-volume claim.</span>
                {board.keywordClusters.map((c) => (
                  <div key={c.intent}>
                    <strong style={{ fontSize: 13 }}>{c.intent}</strong>
                    <div className="chip-list" style={{ marginTop: 4 }}>
                      {c.keywords.map((k) => (
                        <span key={k} className="chip">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {board.keywordSource && <span className="muted" style={{ fontSize: 12 }}>Source: {board.keywordSource}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
