import Papa from "papaparse";
import { newId } from "@/lib/util/ids";
import type { MarketProduct } from "@/lib/market/types";
import { curveConfidence, curveMonthly, type SalesCurve } from "./calibrate";

/**
 * Research workspace. BookStudio ships no scraped marketplace data: observations
 * come from files the user is allowed to use (their own exports, licensed feeds,
 * manual notes). Every displayed metric says whether it is observed or estimated.
 */

export interface Observation {
  id: string;
  title: string;
  asin: string;
  author: string;
  bsr: number | null;
  price: number | null;
  reviews: number | null;
  rating: number | null;
  pages: number | null;
  category: string;
  observedAt: string;
  source: string;
}

export interface Estimate {
  value: number;
  interval95: [number, number];
  method: string;
  estimated: true;
  confidence: "low" | "medium" | "high";
}

export interface ResearchBoard {
  id: string;
  name: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  observations: Observation[];
  keywordClusters: { intent: string; keywords: string[] }[];
  keywordSource: string;
  notes: string;
}

const FIELD_ALIASES: Record<keyof Omit<Observation, "id" | "source">, string[]> = {
  title: ["title", "product title", "name", "book title"],
  asin: ["asin", "isbn", "id", "product id"],
  author: ["author", "authors", "brand", "contributor"],
  bsr: ["bsr", "best sellers rank", "bestsellers rank", "sales rank", "rank"],
  price: ["price", "list price", "price usd", "amount"],
  reviews: ["reviews", "review count", "ratings", "number of reviews", "ratings count"],
  rating: ["rating", "stars", "average rating"],
  pages: ["pages", "page count", "print length"],
  category: ["category", "categories", "browse node"],
  observedAt: ["observed at", "date", "observed", "captured", "timestamp"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[,$#\s]/g, "");
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export interface ImportResult {
  observations: Observation[];
  mapped: Record<string, string>;
  skipped: number;
}

export function importObservationsCsv(text: string, source: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const mapped: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const h = headers.find((hd) => aliases.includes(norm(hd))) ?? headers.find((hd) => aliases.some((a) => norm(hd).includes(a)));
    if (h) mapped[field] = h;
  }
  if (!mapped.title) throw new Error(`No title column found. Columns: ${headers.join(", ")}`);
  const now = new Date().toISOString();
  let skipped = 0;
  const observations: Observation[] = [];
  for (const row of parsed.data) {
    const title = String(row[mapped.title] ?? "").trim();
    if (!title) {
      skipped++;
      continue;
    }
    const get = (f: string) => (mapped[f] ? row[mapped[f]] : undefined);
    observations.push({
      id: newId("obs"),
      title,
      asin: String(get("asin") ?? "").trim(),
      author: String(get("author") ?? "").trim(),
      bsr: num(get("bsr")),
      price: num(get("price")),
      reviews: num(get("reviews")),
      rating: num(get("rating")),
      pages: num(get("pages")),
      category: String(get("category") ?? "").trim(),
      observedAt: String(get("observedAt") ?? "").trim() || now,
      source,
    });
  }
  return { observations, mapped, skipped };
}

/**
 * Rank-to-sales heuristic for the US print books store: daily sales ~ 100000 / BSR.
 * Uncalibrated (no public ground truth), so the interval is wide and confidence low.
 * With a curve fitted to the publisher's own royalty reports and rank history
 * (Sales reports → Calibrate), that curve is used instead.
 */
export const RANK_MODEL = "rank_sales_power_law_v1";
export const CALIBRATED_MODEL = "rank_sales_fitted_to_your_books";

const r1 = (n: number) => Math.round(n * 10) / 10;

export function estimateMonthlySales(bsr: number | null, curve?: SalesCurve | null): Estimate | null {
  if (!bsr || bsr <= 0) return null;
  if (curve) {
    const monthly = curveMonthly(curve, bsr);
    const spread = Math.exp(1.96 * curve.sd);
    return { value: r1(monthly), interval95: [r1(monthly / spread), r1(monthly * spread)], method: `${CALIBRATED_MODEL} (${curve.n} book-months)`, estimated: true, confidence: curveConfidence(curve) };
  }
  const daily = 100000 / bsr;
  const monthly = daily * 30;
  return { value: r1(monthly), interval95: [r1(monthly * 0.4), r1(monthly * 2.5)], method: RANK_MODEL, estimated: true, confidence: "low" };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface NicheSummary {
  count: number;
  medianBsr: number | null;
  medianPrice: number | null;
  medianReviews: number | null;
  estMonthlyUnits: Estimate | null;
  estMonthlyRevenue: Estimate | null;
  competition: number;
  demand: number;
  opportunity: number;
  explanation: string[];
}

export function summarizeNiche(obs: Observation[], curve?: SalesCurve | null): NicheSummary {
  const bsrs = obs.map((o) => o.bsr).filter((x): x is number => !!x && x > 0);
  const prices = obs.map((o) => o.price).filter((x): x is number => x !== null);
  const reviews = obs.map((o) => o.reviews).filter((x): x is number => x !== null);
  const est = bsrs.map((b) => estimateMonthlySales(b, curve)!);
  const units = est.reduce((a, e) => a + e.value, 0);
  const lo = est.reduce((a, e) => a + e.interval95[0], 0);
  const hi = est.reduce((a, e) => a + e.interval95[1], 0);
  const medPrice = median(prices);
  const estMonthlyUnits: Estimate | null = est.length
    ? { value: Math.round(units), interval95: [Math.round(lo), Math.round(hi)], method: `${est[0].method} summed over ${est.length} titles`, estimated: true, confidence: est[0].confidence }
    : null;
  const estMonthlyRevenue: Estimate | null =
    estMonthlyUnits && medPrice
      ? { value: Math.round(estMonthlyUnits.value * medPrice), interval95: [Math.round(estMonthlyUnits.interval95[0] * medPrice), Math.round(estMonthlyUnits.interval95[1] * medPrice)], method: "estimated units x median list price", estimated: true, confidence: estMonthlyUnits.confidence }
      : null;
  const medBsr = median(bsrs);
  // Demand: 0-100 on a log scale, BSR 1k -> ~100, BSR 1M -> ~0.
  const demand = medBsr ? Math.max(0, Math.min(100, Math.round(((6 - Math.log10(medBsr)) / 3) * 100))) : 0;
  const medRev = median(reviews) ?? 0;
  const strong = reviews.length ? reviews.filter((r) => r >= 100).length / reviews.length : 0;
  const competition = Math.round(Math.min(100, strong * 70 + Math.min(30, Math.log10(medRev + 1) * 10)));
  const opportunity = Math.round(Math.max(0, Math.min(100, demand * 0.6 + (100 - competition) * 0.4)));
  const explanation = [
    medBsr ? `Median BSR ${Math.round(medBsr).toLocaleString()} (observed) → demand ${demand}/100.` : "No BSR data, so demand cannot be estimated.",
    reviews.length ? `${Math.round(strong * 100)}% of titles have 100+ reviews; median ${Math.round(medRev)} → competition ${competition}/100.` : "No review counts, so competition is unknown.",
    "Opportunity = 60% demand + 40% (100 - competition). Treat it as a sorting aid, not a forecast.",
  ];
  return { count: obs.length, medianBsr: medBsr, medianPrice: medPrice, medianReviews: median(reviews), estMonthlyUnits, estMonthlyRevenue, competition, demand, opportunity, explanation };
}

const STOP = new Set("a an and the of for to in on with by your my our from at as is it this that be or vs".split(" "));

/** Most frequent 1-3 word phrases in observed titles (an observation, not search volume). */
export function titlePhrases(obs: Observation[], top = 25): { phrase: string; titles: number }[] {
  const counts = new Map<string, Set<number>>();
  obs.forEach((o, idx) => {
    const words = o.title.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
    for (let n = 1; n <= 3; n++)
      for (let i = 0; i + n <= words.length; i++) {
        const gram = words.slice(i, i + n);
        if (STOP.has(gram[0]) || STOP.has(gram[gram.length - 1]) || gram.some((w) => w.length < 2)) continue;
        const key = gram.join(" ");
        if (!counts.has(key)) counts.set(key, new Set());
        counts.get(key)!.add(idx);
      }
  });
  return [...counts.entries()]
    .map(([phrase, set]) => ({ phrase, titles: set.size }))
    .filter((p) => p.titles >= 2 || obs.length < 5)
    .sort((a, b) => b.titles - a.titles || b.phrase.split(" ").length - a.phrase.split(" ").length)
    .slice(0, top);
}

export function newBoard(name: string, topic: string): ResearchBoard {
  const now = new Date().toISOString();
  return { id: newId("rb"), name, topic, createdAt: now, updatedAt: now, observations: [], keywordClusters: [], keywordSource: "", notes: "" };
}

export const SAMPLE_CSV = `title,asin,author,bsr,price,reviews,rating,pages,category,observed_at
Gratitude Journal for Women: 5 Minute Daily Practice,EXAMPLE001,Sample Author A,4200,7.99,1840,4.7,120,Self-Help > Journal Writing,2026-10-01
The Gratitude Journal: Daily Prompts for Mindfulness,EXAMPLE002,Sample Author B,15800,8.99,640,4.6,110,Self-Help > Journal Writing,2026-10-01
Daily Gratitude Journal: 52 Weeks of Thankfulness,EXAMPLE003,Sample Author C,38000,6.99,210,4.5,160,Self-Help > Journal Writing,2026-10-01
Gratitude Journal for Kids: Fun Daily Prompts,EXAMPLE004,Sample Author D,22000,7.49,95,4.8,100,Children's Books > Activities,2026-10-01
Mindful Gratitude Journal for Busy Moms,EXAMPLE005,Sample Author E,120000,8.49,34,4.4,120,Self-Help > Journal Writing,2026-10-01
Gratitude Journal: One Line a Day,EXAMPLE006,Sample Author F,310000,6.99,12,4.2,110,Self-Help > Journal Writing,2026-10-01
`;

/** Competing books from a market data provider, as board observations. */
export function observationsFromMarket(products: MarketProduct[], source: string, observedAt: string): Observation[] {
  return products.map((p) => ({ id: newId("obs"), title: p.title, asin: p.asin, author: p.author, bsr: p.bsr, price: p.price, reviews: p.reviews, rating: p.rating, pages: p.pages, category: "", observedAt, source }));
}
