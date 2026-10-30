import type { RankPoint } from "@/lib/market/types";
import { asinOf, monthKey, type SaleRow } from "./sales";

/**
 * Fits the rank-to-sales curve to the publisher's own books: their royalty
 * reports say how many copies sold each month, and the rank history says
 * where the book sat on Amazon.com that month. The fit is a power law,
 * log(units a day) = a + b × log(BSR), so the default 100000 / BSR curve is
 * the special case a = log(100000), b = -1.
 */

export interface CalibrationPoint {
  asin: string;
  month: string;
  /** Geometric mean of the month's sales ranks. */
  bsr: number;
  unitsPerDay: number;
}

export interface SalesCurve {
  a: number;
  b: number;
  /** Book-months it was fitted from. */
  n: number;
  books: number;
  r2: number;
  /** Residual standard deviation in log space, for the interval. */
  sd: number;
  fittedAt: string;
}

/** Where the fitted curve is kept in IndexedDB. */
export const CURVE_KEY = "sales:curve";

/** Fewer book-months than this and the fit is noise; the default curve is used. */
export const MIN_POINTS = 6;

const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return y && m ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 30;
};

/** One point per book per month that has both US sales and a rank. Months with no sales are left out, since a log can't hold zero. */
export function calibrationPoints(rows: SaleRow[], histories: { asin: string; history: RankPoint[] }[]): CalibrationPoint[] {
  const units = new Map<string, number>();
  for (const r of rows) {
    if (!/^amazon\.com$/i.test(r.marketplace.trim()) || r.units <= 0) continue;
    const k = `${asinOf(r.asin)}|${monthKey(r.date)}`;
    units.set(k, (units.get(k) ?? 0) + r.units);
  }
  const points: CalibrationPoint[] = [];
  for (const { asin, history } of histories) {
    const logs = new Map<string, number[]>();
    for (const p of history) {
      const d = new Date(p.t);
      const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      logs.set(m, [...(logs.get(m) ?? []), Math.log(p.rank)]);
    }
    for (const [month, ls] of logs) {
      const sold = units.get(`${asin.toUpperCase()}|${month}`);
      if (!sold) continue;
      points.push({ asin, month, bsr: Math.round(Math.exp(ls.reduce((a, b) => a + b, 0) / ls.length)), unitsPerDay: sold / daysIn(month) });
    }
  }
  return points.sort((x, y) => x.asin.localeCompare(y.asin) || x.month.localeCompare(y.month));
}

/** Least squares in log space. Null when there are too few points or the fit says better rank means fewer sales. */
export function fitSalesCurve(points: CalibrationPoint[], now = new Date()): SalesCurve | null {
  if (points.length < MIN_POINTS) return null;
  const xs = points.map((p) => Math.log(p.bsr));
  const ys = points.map((p) => Math.log(p.unitsPerDay));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  if (b >= 0) return null;
  const a = my - b * mx;
  const sse = ys.reduce((s, y, i) => s + (y - (a + b * xs[i])) ** 2, 0);
  return {
    a,
    b,
    n: points.length,
    books: new Set(points.map((p) => p.asin)).size,
    r2: syy === 0 ? 0 : 1 - sse / syy,
    sd: Math.sqrt(sse / Math.max(1, points.length - 2)),
    fittedAt: now.toISOString(),
  };
}

export const curveConfidence = (c: SalesCurve): "low" | "medium" | "high" => (c.n >= 24 && c.r2 >= 0.6 ? "high" : c.n >= 12 && c.r2 >= 0.4 ? "medium" : "low");

/** Copies a month at a rank, by the fitted curve. */
export const curveMonthly = (c: SalesCurve, bsr: number) => 30 * Math.exp(c.a + c.b * Math.log(bsr));
