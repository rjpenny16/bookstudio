import "server-only";
import { DataForSeoError, rankedKeywords, relatedKeywords, searchVolumes, type DfsCredentials } from "./dataforseo";
import { KeepaError, keepaPing, keepaProducts, keepaSearch, rankHistory, toMarketProduct } from "./keepa";
import { rankKeywords } from "./keywords";
import type { KeywordMetric, MarketSnapshot, MarketStatus, RankPoint } from "./types";

/**
 * The server side of market data. Keys stay in the server's environment:
 * KEEPA_API_KEY for products and sales ranks, DATAFORSEO_LOGIN and
 * DATAFORSEO_PASSWORD for keyword volumes. Either can be set without the other.
 */

export interface MarketUsage {
  keepaTokens: number;
  dataforseoUsd: number;
}

export class MarketError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const keepaKey = () => process.env.KEEPA_API_KEY?.trim() || "";
function dfsCredentials(): DfsCredentials | null {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  return login && password ? { login, password } : null;
}

export function marketStatus(): MarketStatus {
  const k = !!keepaKey();
  const d = !!dfsCredentials();
  return {
    products: k
      ? { configured: true, provider: "keepa", detail: "Competing books, prices, reviews and sales rank history from Keepa" }
      : { configured: false, provider: "off", detail: "Set KEEPA_API_KEY to see competing books, prices and sales ranks" },
    keywords: d
      ? { configured: true, provider: "dataforseo", detail: "Monthly Amazon search volumes from DataForSEO" }
      : { configured: false, provider: "off", detail: "Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD for Amazon search volumes" },
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const statusOf = (e: unknown) => (e instanceof KeepaError || e instanceof DataForSeoError ? e.status : 500);

/** How many competing books a snapshot keeps. */
const TOP_PRODUCTS = 20;

/** Competing books for a search and the phrases shoppers use around it. A provider that fails leaves a warning, not an error, while the other still answers. */
export async function marketSnapshot(keyword: string, signal?: AbortSignal): Promise<{ snapshot: MarketSnapshot; usage: MarketUsage; warnings: string[] }> {
  const key = keepaKey();
  const cred = dfsCredentials();
  if (!key && !cred) throw new MarketError("No market data provider is set up. Add KEEPA_API_KEY and/or DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to the server's environment.", 400);
  const usage: MarketUsage = { keepaTokens: 0, dataforseoUsd: 0 };
  const warnings: string[] = [];
  const sources: string[] = [];

  const products = key
    ? await keepaSearch(keyword, key, 2, signal).then(
        (r) => {
          usage.keepaTokens += r.tokens;
          sources.push("keepa");
          return r.products.slice(0, TOP_PRODUCTS).map(toMarketProduct);
        },
        (e: unknown) => {
          warnings.push(message(e));
          return [];
        },
      )
    : [];

  let keywords: KeywordMetric[] = [];
  if (cred) {
    try {
      const related = await relatedKeywords(keyword, cred, 60, signal);
      usage.dataforseoUsd += related.cost;
      keywords = related.keywords;
      // What the best-selling competitor is found by: phrases the seed's neighbours can miss.
      const leader = products.filter((p) => p.bsr).sort((a, b) => a.bsr! - b.bsr!)[0];
      if (leader) {
        const ranked = await rankedKeywords(leader.asin, cred, 50, signal);
        usage.dataforseoUsd += ranked.cost;
        keywords = [...keywords, ...ranked.keywords];
      }
      sources.push("dataforseo");
    } catch (e) {
      warnings.push(message(e));
    }
  }
  if (!sources.length) throw new MarketError(warnings.join(" "), 502);

  return {
    snapshot: { keyword, fetchedAt: new Date().toISOString(), source: sources.join(" + "), products, keywords: rankKeywords(keywords) },
    usage,
    warnings,
  };
}

/** Sales rank history for books by ASIN (your own, to calibrate sales estimates). */
export async function rankHistories(asins: string[], signal?: AbortSignal): Promise<{ books: { asin: string; title: string; history: RankPoint[] }[]; usage: MarketUsage }> {
  const key = keepaKey();
  if (!key) throw new MarketError("Set KEEPA_API_KEY to read sales rank history.", 400);
  try {
    const r = await keepaProducts(asins, key, signal);
    return { books: r.products.map((p) => ({ asin: p.asin, title: p.title ?? "", history: rankHistory(p) })), usage: { keepaTokens: r.tokens, dataforseoUsd: 0 } };
  } catch (e) {
    throw new MarketError(message(e), statusOf(e));
  }
}

export async function keywordVolumes(keywords: string[], signal?: AbortSignal): Promise<{ keywords: KeywordMetric[]; usage: MarketUsage }> {
  const cred = dfsCredentials();
  if (!cred) throw new MarketError("Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD for search volumes.", 400);
  try {
    const r = await searchVolumes(keywords, cred, signal);
    return { keywords: r.keywords, usage: { keepaTokens: 0, dataforseoUsd: r.cost } };
  } catch (e) {
    throw new MarketError(message(e), statusOf(e));
  }
}

/** One small request to each provider: a category lookup (1 Keepa token), or one phrase's volume. */
export async function testMarket(target: "products" | "keywords"): Promise<{ ok: boolean; detail: string; ms: number }> {
  const start = Date.now();
  try {
    if (target === "products") {
      const key = keepaKey();
      if (!key) throw new Error("KEEPA_API_KEY isn't set.");
      const left = await keepaPing(key);
      return { ok: true, detail: `Keepa key works; ${left.toLocaleString("en-US")} tokens left`, ms: Date.now() - start };
    }
    const r = await keywordVolumes(["sudoku"]);
    const v = r.keywords[0]?.volume;
    return { ok: true, detail: `DataForSEO login works; "sudoku" has ${v === null || v === undefined ? "no recorded" : v.toLocaleString("en-US")} monthly searches (cost $${r.usage.dataforseoUsd.toFixed(4)})`, ms: Date.now() - start };
  } catch (e) {
    return { ok: false, detail: message(e), ms: Date.now() - start };
  }
}
