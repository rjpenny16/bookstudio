import type { PrintSpec } from "@/lib/schema/project";
import { royaltyUsd } from "./geometry";
import { ROYALTY_US } from "./rules";

/**
 * A list price worked out from the numbers that decide what a sale earns: the
 * print cost, KDP's royalty threshold (60% at $9.99 and up, 50% below) and,
 * when there is market data, what competing books cost. Prices end in .99.
 */

/** What comparable books sell for: the middle half of their prices. */
export interface PriceBand {
  low: number;
  median: number;
  high: number;
  /** How many prices it was measured from. */
  n: number;
}

export interface PriceRecommendation {
  price: number;
  royalty: number;
  rate: number;
  /** The lowest .99 price that still earns MIN_ROYALTY_USD a copy. */
  floor: number;
  band: PriceBand | null;
  reason: string;
}

/** A price that earns less than this a copy isn't worth publishing at. */
export const MIN_ROYALTY_USD = 1;
/** How far under the threshold a price may sit and still be raised to it: $1.50 more a copy for at most $1.50 more on the price. */
const BUMP_WITHIN_USD = 1.5;
/** With no market data and no suggestion, start here. */
const DEFAULT_TARGET_USD = 9.99;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** The nearest price ending in .99 (8.50 → 8.99, 7.95 → 7.99). */
export const charm = (n: number) => Math.max(0.99, r2(Math.round(n + 0.01) - 0.01));
/** The lowest price ending in .99 at or above n. */
const charmUp = (n: number) => Math.max(0.99, r2(Math.ceil(r2(n + 0.01)) - 0.01));
const money = (n: number) => `$${n.toFixed(2)}`;

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** The interquartile price range of comparable books; null with fewer than 3 usable prices. */
export function priceBand(prices: (number | null | undefined)[]): PriceBand | null {
  const p = prices.filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (p.length < 3) return null;
  return { low: r2(quantile(p, 0.25)), median: r2(quantile(p, 0.5)), high: r2(quantile(p, 0.75)), n: p.length };
}

/** The lowest .99 price that earns at least `minRoyalty` a copy at the rate that price gets. */
export function floorPrice(spec: PrintSpec, pageCount: number, minRoyalty = MIN_ROYALTY_USD): number {
  const cost = royaltyUsd(spec, pageCount, 0).printCost;
  if (!Number.isFinite(cost)) return NaN;
  const low = charmUp((cost + minRoyalty) / ROYALTY_US.lowRate);
  if (low < ROYALTY_US.thresholdUsd) return low;
  return Math.max(ROYALTY_US.thresholdUsd, charmUp((cost + minRoyalty) / ROYALTY_US.highRate));
}

export function recommendPrice(spec: PrintSpec, pageCount: number, opts: { competitorPrices?: (number | null | undefined)[]; suggested?: number } = {}): PriceRecommendation {
  const band = priceBand(opts.competitorPrices ?? []);
  const floor = floorPrice(spec, pageCount);
  const why: string[] = [];

  let price: number;
  if (band) {
    price = charm(band.median);
    why.push(`the middle of what ${band.n} comparable books charge (${money(band.low)}–${money(band.high)})`);
  } else if (opts.suggested && opts.suggested > 0) {
    price = charm(opts.suggested);
    why.push("a typical price for this kind and size of book (no market data yet)");
  } else {
    price = DEFAULT_TARGET_USD;
    why.push("a common price for this kind of book (no market data yet)");
  }

  // Just under the threshold, a small price rise earns 60% instead of 50%, unless shoppers here don't pay that much.
  const t = ROYALTY_US.thresholdUsd;
  if (price < t && price >= t - BUMP_WITHIN_USD && (!band || band.high >= t)) {
    const before = royaltyUsd(spec, pageCount, price).royalty;
    const after = royaltyUsd(spec, pageCount, t).royalty;
    if (after > before) {
      why.push(`raised to ${money(t)}, where the royalty rate goes from 50% to 60% (${money(after)} instead of ${money(before)} a copy)`);
      price = t;
    }
  }

  if (Number.isFinite(floor) && price < floor) {
    price = floor;
    const over = band && floor > band.high;
    why.push(`at least ${money(floor)} so each copy earns ${money(MIN_ROYALTY_USD)} or more after printing${over ? "; that is above most competitors, so fewer pages or black ink would help" : ""}`);
  }

  const r = royaltyUsd(spec, pageCount, price);
  return { price, royalty: r.royalty, rate: r.rate, floor, band, reason: `${money(price)}: ${why.join("; ")}.` };
}
