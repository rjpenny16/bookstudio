"use client";

import { useEffect, useState } from "react";
import { marketStatus, marketUsage, testMarket, type MarketUsageTotal } from "@/lib/market/client";
import type { MarketStatus } from "@/lib/market/types";

type Target = "products" | "keywords";
interface TestResult {
  ok: boolean;
  detail: string;
  ms: number;
}

/** Settings: which market data providers are set up, a live test of each, and what they've cost so far. */
export function MarketDataCard() {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [usage, setUsage] = useState<MarketUsageTotal | null>(null);
  const [tests, setTests] = useState<Partial<Record<Target, TestResult>>>({});
  const [testing, setTesting] = useState<Target | null>(null);
  useEffect(() => {
    marketStatus().then(setStatus).catch(() => setStatus(null));
    marketUsage().then((u) => setUsage(u ?? null));
  }, []);

  const test = async (target: Target) => {
    setTesting(target);
    try {
      const r = await testMarket(target);
      setTests((t) => ({ ...t, [target]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [target]: { ok: false, detail: e instanceof Error ? e.message : String(e), ms: 0 } }));
    } finally {
      setTesting(null);
    }
  };

  const row = (target: Target, name: string) => {
    const s = status?.[target];
    const r = tests[target];
    return (
      <li className="check-item" aria-label={name}>
        <span className={`check-icon ${s?.configured ? "pass" : "warn"}`} aria-label={s?.configured ? "Active" : "Not active"}>
          {s?.configured ? "✓" : "–"}
        </span>
        <div>
          <strong>{name}</strong> <span className="badge">{s?.provider ?? "…"}</span>
          <div className="muted" style={{ fontSize: 13 }}>{s?.detail ?? "Checking…"}</div>
          {r && (
            <div className={`notice ${r.ok ? "notice-pass" : "notice-fail"}`} style={{ marginTop: 6, fontSize: 13 }} role="status" data-market={target}>
              {r.ok ? "Connected" : "Failed"}: {r.detail} ({r.ms} ms)
            </div>
          )}
        </div>
        <div>
          <button className="btn btn-sm" onClick={() => test(target)} disabled={testing !== null || !s?.configured}>
            {testing === target && <span className="spinner" />} Test connection
          </button>
        </div>
      </li>
    );
  };

  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>Market data</h2>
      <p className="muted" style={{ margin: 0 }}>
        With a provider set up, autopilot prices each book against its competitors and fills the keyword slots with the phrases shoppers search most. Data comes from licensed APIs, never from scraping, and each search is kept for a week so it isn&apos;t paid for twice.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Market data providers">
        {row("products", "Competing books & sales ranks")}
        {row("keywords", "Amazon search volumes")}
      </ul>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
        <li><code>KEEPA_API_KEY</code>: a <a href="https://keepa.com/#!api">Keepa API</a> key (paid subscription, billed in tokens; a search for a book idea uses about 20).</li>
        <li><code>DATAFORSEO_LOGIN</code> and <code>DATAFORSEO_PASSWORD</code>: a <a href="https://dataforseo.com/apis/dataforseo-labs-api">DataForSEO</a> API login (pay as you go; each request&apos;s cost is shown here).</li>
      </ul>
      {usage && (
        <p className="field-hint" style={{ margin: 0 }} data-testid="market-usage">
          Used since {new Date(usage.since).toLocaleDateString()}: {usage.keepaTokens.toLocaleString()} Keepa tokens, ${usage.dataforseoUsd.toFixed(2)} DataForSEO.
        </p>
      )}
    </div>
  );
}
