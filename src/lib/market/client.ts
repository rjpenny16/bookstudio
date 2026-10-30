import { getValue, setValue } from "@/lib/storage/db";
import type { KeywordMetric, MarketSnapshot, MarketStatus, RankPoint } from "./types";

/**
 * Browser side of market data: calls /api/market, keeps answers in IndexedDB
 * so the same search isn't paid for twice in a week, and keeps a running
 * total of what the providers have charged.
 */

export interface MarketUsageTotal {
  keepaTokens: number;
  dataforseoUsd: number;
  since: string;
}

const USAGE_KEY = "market:usage";
/** Market data older than this is fetched again. */
export const SNAPSHOT_TTL_MS = 7 * 24 * 3600 * 1000;

const cacheKey = (keyword: string) => `market:snapshot:${keyword.toLowerCase().replace(/\s+/g, " ").trim()}`;

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/market", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Market data request failed (${res.status})`);
  return json as T;
}

async function addUsage(u: { keepaTokens: number; dataforseoUsd: number } | undefined) {
  if (!u || (!u.keepaTokens && !u.dataforseoUsd)) return;
  const t = (await getValue<MarketUsageTotal>(USAGE_KEY)) ?? { keepaTokens: 0, dataforseoUsd: 0, since: new Date().toISOString() };
  await setValue(USAGE_KEY, { ...t, keepaTokens: t.keepaTokens + u.keepaTokens, dataforseoUsd: t.dataforseoUsd + u.dataforseoUsd });
}

export const marketUsage = () => getValue<MarketUsageTotal>(USAGE_KEY);

export async function marketStatus(): Promise<MarketStatus> {
  const res = await fetch("/api/market");
  if (!res.ok) throw new Error(`Market status failed (${res.status})`);
  return res.json();
}

export const marketConfigured = (s: MarketStatus | null | undefined) => !!s && (s.products.configured || s.keywords.configured);

/** Competing books and search phrases for a keyword, from the cache when it is under a week old. */
export async function fetchSnapshot(keyword: string, opts: { fresh?: boolean } = {}): Promise<{ snapshot: MarketSnapshot; cached: boolean; warnings: string[] }> {
  const key = cacheKey(keyword);
  if (!opts.fresh) {
    const hit = await getValue<MarketSnapshot>(key);
    if (hit && Date.now() - Date.parse(hit.fetchedAt) < SNAPSHOT_TTL_MS) return { snapshot: hit, cached: true, warnings: [] };
  }
  const r = await post<{ snapshot: MarketSnapshot; usage: { keepaTokens: number; dataforseoUsd: number }; warnings: string[] }>({ action: "snapshot", keyword });
  await setValue(key, r.snapshot);
  await addUsage(r.usage);
  return { snapshot: r.snapshot, cached: false, warnings: r.warnings };
}

/**
 * Market data for autopilot when a provider is set up; null (with the reason)
 * otherwise, so a book can always be built without it.
 */
export async function snapshotForBook(keyword: string): Promise<{ snapshot: MarketSnapshot | null; note: string }> {
  try {
    if (!marketConfigured(await marketStatus())) return { snapshot: null, note: "" };
    const r = await fetchSnapshot(keyword);
    const s = r.snapshot;
    return { snapshot: s, note: `Market data${r.cached ? " (cached)" : ""}: ${s.products.length} competing books, ${s.keywords.length} search phrases from ${s.source}${r.warnings.length ? `. ${r.warnings.join(" ")}` : ""}` };
  } catch (e) {
    return { snapshot: null, note: `Market data skipped: ${e instanceof Error ? e.message : e}` };
  }
}

export async function fetchRankHistory(asins: string[]): Promise<{ asin: string; title: string; history: RankPoint[] }[]> {
  const r = await post<{ books: { asin: string; title: string; history: RankPoint[] }[]; usage: { keepaTokens: number; dataforseoUsd: number } }>({ action: "history", asins });
  await addUsage(r.usage);
  return r.books;
}

export async function fetchVolumes(keywords: string[]): Promise<KeywordMetric[]> {
  const r = await post<{ keywords: KeywordMetric[]; usage: { keepaTokens: number; dataforseoUsd: number } }>({ action: "volumes", keywords });
  await addUsage(r.usage);
  return r.keywords;
}

export const testMarket = (target: "products" | "keywords") => post<{ ok: boolean; detail: string; ms: number }>({ action: "test", target });
