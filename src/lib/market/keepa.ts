import type { MarketProduct, RankPoint } from "./types";

/**
 * Keepa API (https://keepa.com/#!api): Amazon product data Keepa collects and
 * licenses, so BookStudio never scrapes Amazon itself. Prices are in cents,
 * -1 means "no data", and times are Keepa minutes (minutes since 2011-01-01).
 * Field names follow Keepa's own client, keepacom/api_backend.
 */

const BASE = "https://api.keepa.com";
/** Amazon.com in Keepa's domain list (RESERVED, US, GB, ...). */
const DOMAIN_US = 1;
/** The root Books category on amazon.com. */
export const BOOKS_ROOT_US = 283155;
/** Keepa's csv history slots. */
const CSV = { AMAZON: 0, NEW: 1, SALES: 3, LISTPRICE: 4, RATING: 16, COUNT_REVIEWS: 17 } as const;
const KEEPA_START_MINUTE = 21564000;

export const keepaMinuteToMs = (m: number) => (m + KEEPA_START_MINUTE) * 60_000;

/** The parts of a Keepa product BookStudio reads. */
export interface KeepaProduct {
  asin: string;
  title?: string | null;
  author?: string | null;
  binding?: string | null;
  rootCategory?: number;
  numberOfPages?: number;
  publicationDate?: number;
  monthlySold?: number;
  images?: { l?: string; m?: string }[] | null;
  imagesCSV?: string | null;
  csv?: (number[] | null)[] | null;
  stats?: { current?: number[] | null } | null;
}

export interface KeepaResponse {
  products?: KeepaProduct[];
  tokensLeft?: number;
  tokensConsumed?: number;
  refillIn?: number;
  error?: { type?: string; message?: string };
}

const known = (n: number | undefined | null) => (typeof n === "number" && n >= 0 ? n : null);

/** The newest value of a history slot: the stats snapshot when there is one, else the last point of the csv history. */
function latest(p: KeepaProduct, slot: number): number | null {
  const cur = known(p.stats?.current?.[slot]);
  if (cur !== null) return cur;
  const h = p.csv?.[slot];
  return h && h.length >= 2 ? known(h[h.length - 1]) : null;
}

/** 20150409 → "2015-04-09", 200301 → "2003-01", 1978 → "1978". */
export function keepaDate(n: number | undefined): string {
  if (!n || n < 0) return "";
  const s = String(n);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : s.length === 6 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}

export function toMarketProduct(p: KeepaProduct): MarketProduct {
  const cents = latest(p, CSV.LISTPRICE) ?? latest(p, CSV.AMAZON) ?? latest(p, CSV.NEW);
  const rating = latest(p, CSV.RATING);
  const image = p.images?.[0]?.l ?? p.images?.[0]?.m ?? p.imagesCSV?.split(",")[0] ?? "";
  return {
    asin: p.asin,
    title: p.title ?? "",
    author: p.author ?? "",
    bsr: latest(p, CSV.SALES),
    price: cents === null ? null : cents / 100,
    reviews: latest(p, CSV.COUNT_REVIEWS),
    rating: rating === null ? null : rating / 10,
    pages: known(p.numberOfPages) || null,
    publishedAt: keepaDate(p.publicationDate),
    imageUrl: image ? `https://m.media-amazon.com/images/I/${image}` : "",
    monthlySold: known(p.monthlySold) || null,
  };
}

/** A book, judged by its root category or, when Keepa doesn't say, its binding. */
export function isBook(p: KeepaProduct): boolean {
  if (p.rootCategory) return p.rootCategory === BOOKS_ROOT_US;
  return /paperback|hardcover|spiral|book/i.test(p.binding ?? "");
}

/** Sales rank history, oldest first, without the gaps Keepa marks with -1. */
export function rankHistory(p: KeepaProduct): RankPoint[] {
  const h = p.csv?.[CSV.SALES];
  if (!h) return [];
  const out: RankPoint[] = [];
  for (let i = 0; i + 1 < h.length; i += 2) if (h[i + 1] > 0) out.push({ t: keepaMinuteToMs(h[i]), rank: h[i + 1] });
  return out;
}

export class KeepaError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, params: Record<string, string>, key: string, signal?: AbortSignal): Promise<KeepaResponse> {
  const qs = new URLSearchParams({ key, domain: String(DOMAIN_US), ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`, { signal: signal ?? AbortSignal.timeout(60_000) }).catch((e: unknown) => {
    throw new KeepaError(`Could not reach Keepa: ${e instanceof Error ? e.message : e}`, 502);
  });
  const body = (await res.json().catch(() => ({}))) as KeepaResponse;
  if (res.status === 429) throw new KeepaError(`Out of Keepa tokens; ${body.refillIn ? `more in ${Math.ceil(body.refillIn / 1000)} s` : "try again shortly"}.`, 429);
  if (res.status === 401 || res.status === 403) throw new KeepaError("Keepa rejected the API key (KEEPA_API_KEY).", 401);
  if (!res.ok || body.error) throw new KeepaError(`Keepa error ${res.status}: ${body.error?.message ?? body.error?.type ?? res.statusText}`, res.status >= 400 ? res.status : 502);
  return body;
}

/** Books Amazon shows for a search, in Keepa's order, ten to a page. */
export async function keepaSearch(term: string, key: string, pages = 2, signal?: AbortSignal): Promise<{ products: KeepaProduct[]; tokens: number }> {
  const products: KeepaProduct[] = [];
  let tokens = 0;
  for (let page = 0; page < pages; page++) {
    const r = await call("search", { type: "product", term, stats: "90", page: String(page) }, key, signal);
    tokens += r.tokensConsumed ?? 0;
    products.push(...(r.products ?? []));
    if ((r.products?.length ?? 0) < 10) break;
  }
  return { products: products.filter(isBook), tokens };
}

/** Up to 100 products by ASIN, with their history. */
export async function keepaProducts(asins: string[], key: string, signal?: AbortSignal): Promise<{ products: KeepaProduct[]; tokens: number }> {
  const r = await call("product", { asin: asins.slice(0, 100).join(","), stats: "90", history: "1", rating: "1" }, key, signal);
  return { products: r.products ?? [], tokens: r.tokensConsumed ?? 0 };
}

/** Looks up the Books category: the smallest request that proves the key works (1 token). Returns the tokens left. */
export async function keepaPing(key: string): Promise<number> {
  const r = await call("category", { category: String(BOOKS_ROOT_US), parents: "0" }, key);
  return r.tokensLeft ?? 0;
}
