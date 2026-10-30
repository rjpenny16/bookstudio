import Papa from "papaparse";

/** Rows imported from the user's own KDP royalty / sales reports. */
export interface SaleRow {
  date: string;
  title: string;
  asin: string;
  marketplace: string;
  units: number;
  royalty: number;
  currency: string;
}

const ALIASES: Record<keyof SaleRow, string[]> = {
  date: ["royalty date", "date", "order date", "month", "period"],
  title: ["title", "book title"],
  asin: ["asin", "asin/isbn", "isbn", "asin isbn"],
  marketplace: ["marketplace", "store"],
  units: ["net units sold", "units sold", "units", "net units", "quantity"],
  royalty: ["royalty", "royalties", "earnings"],
  currency: ["currency"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();
const num = (v: unknown) => {
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function importSalesCsv(text: string): { rows: SaleRow[]; mapped: Record<string, string> } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields ?? [];
  const mapped: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const h = headers.find((x) => aliases.includes(norm(x))) ?? headers.find((x) => aliases.some((a) => norm(x).includes(a)));
    if (h) mapped[field] = h;
  }
  if (!mapped.title || !mapped.units) throw new Error(`Need at least a title and a units column. Found: ${headers.join(", ")}`);
  const rows = parsed.data
    .map((r) => ({
      date: String(r[mapped.date] ?? "").slice(0, 10),
      title: String(r[mapped.title] ?? "").trim(),
      asin: String(r[mapped.asin] ?? "").trim(),
      marketplace: String(r[mapped.marketplace] ?? "").trim() || "Amazon.com",
      units: num(r[mapped.units]),
      royalty: mapped.royalty ? num(r[mapped.royalty]) : 0,
      currency: String(r[mapped.currency] ?? "").trim() || "USD",
    }))
    .filter((r) => r.title);
  return { rows, mapped };
}

export function monthKey(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date.slice(0, 7) || "unknown" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function aggregate(rows: SaleRow[]) {
  const byTitle = new Map<string, { title: string; asin: string; units: number; royalty: Record<string, number> }>();
  const byMonth = new Map<string, { units: number; royalty: Record<string, number> }>();
  for (const r of rows) {
    const t = byTitle.get(r.title) ?? { title: r.title, asin: r.asin, units: 0, royalty: {} };
    t.units += r.units;
    t.royalty[r.currency] = (t.royalty[r.currency] ?? 0) + r.royalty;
    byTitle.set(r.title, t);
    const k = monthKey(r.date);
    const m = byMonth.get(k) ?? { units: 0, royalty: {} };
    m.units += r.units;
    m.royalty[r.currency] = (m.royalty[r.currency] ?? 0) + r.royalty;
    byMonth.set(k, m);
  }
  return {
    titles: [...byTitle.values()].sort((a, b) => b.units - a.units),
    months: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
    totalUnits: rows.reduce((a, r) => a + r.units, 0),
    totalRoyalty: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.currency]: (acc[r.currency] ?? 0) + r.royalty }), {}),
  };
}

export const SAMPLE_SALES = `Royalty Date,Title,ASIN/ISBN,Marketplace,Net Units Sold,Royalty,Currency
2026-07-03,Sample Gratitude Journal,EXAMPLE001,Amazon.com,4,10.12,USD
2026-07-19,Sample Gratitude Journal,EXAMPLE001,Amazon.com,6,15.18,USD
2026-08-02,Sample Gratitude Journal,EXAMPLE001,Amazon.com,9,22.77,USD
2026-08-11,Sample Sudoku Book,EXAMPLE002,Amazon.com,3,9.27,USD
2026-09-05,Sample Gratitude Journal,EXAMPLE001,Amazon.com,12,30.36,USD
2026-09-14,Sample Sudoku Book,EXAMPLE002,Amazon.co.uk,2,4.10,GBP
`;

/** A 978 ISBN-13 as the ISBN-10 Amazon uses as a paperback's ASIN; null for anything else. */
export function isbn13to10(isbn: string): string | null {
  const d = isbn.replace(/[^0-9]/g, "");
  if (d.length !== 13 || !d.startsWith("978")) return null;
  const core = d.slice(3, 12);
  const sum = [...core].reduce((s, c, i) => s + Number(c) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : String(check));
}

/** The ASIN a report's ASIN/ISBN column refers to, or "" when it can't be one. */
export function asinOf(id: string): string {
  const s = id.trim().toUpperCase().replace(/-/g, "");
  if (/^[A-Z0-9]{10}$/.test(s)) return s;
  return isbn13to10(s) ?? "";
}

/** The project a sold title belongs to: by ASIN when both have one, else by exact title. */
export function projectForSale<T extends { title: string; name: string; asin?: string }>(sale: { title: string; asin: string }, projects: T[]): T | undefined {
  const asin = asinOf(sale.asin);
  return (asin ? projects.find((p) => p.asin && p.asin.toUpperCase() === asin) : undefined) ?? projects.find((p) => (p.title || p.name).toLowerCase() === sale.title.toLowerCase());
}
