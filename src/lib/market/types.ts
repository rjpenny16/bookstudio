/**
 * Market data from a licensed provider (Keepa for products, DataForSEO for
 * keyword volumes), shaped the same whichever provider it came from. Numbers
 * here are observed by the provider; estimates made from them say so.
 */

export interface MarketProduct {
  asin: string;
  title: string;
  author: string;
  /** Current Best Sellers Rank in Books; null when the provider has none. */
  bsr: number | null;
  /** Current new price in USD. */
  price: number | null;
  reviews: number | null;
  /** Stars, 0 to 5. */
  rating: number | null;
  pages: number | null;
  /** YYYY-MM-DD, YYYY-MM or YYYY; empty when unknown. */
  publishedAt: string;
  imageUrl: string;
  /** Amazon's "bought in past month" figure when the provider has it. */
  monthlySold: number | null;
}

export interface KeywordMetric {
  keyword: string;
  /** Monthly Amazon searches; null when unknown (a phrase the model suggested, say). */
  volume: number | null;
  source: string;
}

/** What the market looked like for one search, kept with the book it informed. */
export interface MarketSnapshot {
  keyword: string;
  fetchedAt: string;
  /** Providers that supplied it, e.g. "keepa + dataforseo". */
  source: string;
  products: MarketProduct[];
  keywords: KeywordMetric[];
}

/** One point of a product's sales rank history. */
export interface RankPoint {
  /** Unix milliseconds. */
  t: number;
  rank: number;
}

export interface MarketStatus {
  products: { configured: boolean; provider: string; detail: string };
  keywords: { configured: boolean; provider: string; detail: string };
}
