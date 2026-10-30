import type { KeywordMetric } from "./types";

/**
 * DataForSEO Labs Amazon endpoints (https://dataforseo.com/apis/dataforseo-labs-api):
 * monthly Amazon search volumes for phrases, related phrases for a seed, and
 * the phrases a competing ASIN ranks for. Pay as you go; every response says
 * what it cost. Field names follow DataForSEO's own client, dataforseo/TypeScriptClient.
 */

const BASE = "https://api.dataforseo.com/v3/dataforseo_labs/amazon";
/** United States, English. */
const WHERE = { location_code: 2840, language_code: "en" } as const;
const OK = 20000;

export interface DfsCredentials {
  login: string;
  password: string;
}

interface DfsKeywordData {
  keyword?: string;
  keyword_info?: { search_volume?: number | null } | null;
}

interface DfsItem {
  keyword?: string;
  search_volume?: number | null;
  keyword_data?: DfsKeywordData | null;
  ranked_serp_element?: { serp_item?: { rank_absolute?: number } | null } | null;
}

export interface DfsResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: {
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: { items?: DfsItem[] | null; seed_keyword_data?: DfsKeywordData | null }[] | null;
  }[];
}

export class DataForSeoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The items of the first task, or the reason the call failed. */
export function dfsItems(r: DfsResponse): DfsItem[] {
  if (r.status_code !== OK) throw new DataForSeoError(`DataForSEO: ${r.status_message ?? `status ${r.status_code}`}`, 502);
  const t = r.tasks?.[0];
  if (!t || t.status_code !== OK) throw new DataForSeoError(`DataForSEO: ${t?.status_message ?? "no task in the response"}`, 502);
  return t.result?.[0]?.items ?? [];
}

const metric = (keyword: string | undefined, volume: number | null | undefined): KeywordMetric | null => (keyword ? { keyword, volume: typeof volume === "number" ? volume : null, source: "dataforseo" } : null);
const keep = <T,>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);

/** bulk_search_volume: items carry the phrase and its volume directly. */
export const parseVolumes = (r: DfsResponse) => keep(dfsItems(r).map((i) => metric(i.keyword, i.search_volume)));

/** related_keywords and ranked_keywords: the phrase sits in keyword_data. */
export const parseKeywordData = (r: DfsResponse) => keep(dfsItems(r).map((i) => metric(i.keyword_data?.keyword, i.keyword_data?.keyword_info?.search_volume)));

async function post(path: string, task: Record<string, unknown>, cred: DfsCredentials, signal?: AbortSignal): Promise<DfsResponse> {
  const auth = Buffer.from(`${cred.login}:${cred.password}`).toString("base64");
  const res = await fetch(`${BASE}/${path}/live`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify([{ ...WHERE, ...task }]),
    signal: signal ?? AbortSignal.timeout(60_000),
  }).catch((e: unknown) => {
    throw new DataForSeoError(`Could not reach DataForSEO: ${e instanceof Error ? e.message : e}`, 502);
  });
  if (res.status === 401) throw new DataForSeoError("DataForSEO rejected the login (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).", 401);
  if (!res.ok) throw new DataForSeoError(`DataForSEO error ${res.status}`, res.status);
  return (await res.json()) as DfsResponse;
}

/** Monthly Amazon searches for up to 1000 phrases. */
export async function searchVolumes(keywords: string[], cred: DfsCredentials, signal?: AbortSignal) {
  const r = await post("bulk_search_volume", { keywords: keywords.slice(0, 1000) }, cred, signal);
  return { keywords: parseVolumes(r), cost: r.cost ?? 0 };
}

/** Phrases shoppers search around a seed, the seed included. */
export async function relatedKeywords(seed: string, cred: DfsCredentials, limit = 60, signal?: AbortSignal) {
  const r = await post("related_keywords", { keyword: seed, depth: 2, include_seed_keyword: true, limit }, cred, signal);
  const seedData = r.tasks?.[0]?.result?.[0]?.seed_keyword_data;
  const seedMetric = metric(seedData?.keyword, seedData?.keyword_info?.search_volume);
  const items = parseKeywordData(r);
  return { keywords: seedMetric && !items.some((k) => k.keyword === seedMetric.keyword) ? [seedMetric, ...items] : items, cost: r.cost ?? 0 };
}

/** Phrases a competing book ranks for, most-searched first. */
export async function rankedKeywords(asin: string, cred: DfsCredentials, limit = 100, signal?: AbortSignal) {
  const r = await post("ranked_keywords", { asin, limit, order_by: ["keyword_data.keyword_info.search_volume,desc"] }, cred, signal);
  return { keywords: parseKeywordData(r), cost: r.cost ?? 0 };
}
