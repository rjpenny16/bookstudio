import { describe, expect, it } from "vitest";
import { estimateMonthlySales, summarizeNiche, type Observation } from "@/lib/research";
import { calibrationPoints, curveMonthly, fitSalesCurve, MIN_POINTS } from "@/lib/research/calibrate";
import { asinOf, isbn13to10, projectForSale, type SaleRow } from "@/lib/research/sales";

const sale = (date: string, asin: string, units: number, marketplace = "Amazon.com"): SaleRow => ({ date, title: "T", asin, marketplace, units, royalty: units * 2, currency: "USD" });
const at = (month: string, day = 10) => Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, day);

/** A book whose sales follow units a day = 20000 / BSR: a fifth of what the generic 100000 / BSR curve says. */
function book(asin: string, ranks: Record<string, number>) {
  const rows: SaleRow[] = [];
  const history = [];
  for (const [month, bsr] of Object.entries(ranks)) {
    history.push({ t: at(month, 5), rank: bsr }, { t: at(month, 20), rank: bsr });
    const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    rows.push(sale(`${month}-15`, asin, Math.round((20000 / bsr) * days)));
  }
  return { rows, history: { asin, history } };
}

describe("sales calibration", () => {
  const a = book("B0AAAAAAAA", { "2026-03": 2000, "2026-04": 5000, "2026-05": 10000, "2026-06": 40000 });
  const b = book("B0BBBBBBBB", { "2026-03": 3000, "2026-04": 8000, "2026-05": 20000 });
  const rows = [...a.rows, ...b.rows, sale("2026-04-02", "B0AAAAAAAA", 50, "Amazon.co.uk")];

  it("lines up each month's US sales with that month's rank", () => {
    const pts = calibrationPoints(rows, [a.history, b.history]);
    expect(pts).toHaveLength(7);
    expect(pts[0]).toMatchObject({ asin: "B0AAAAAAAA", month: "2026-03", bsr: 2000 });
    // UK sales don't count toward the US rank.
    expect(pts[1].unitsPerDay).toBeCloseTo(20000 / 5000, 1);
  });

  it("recovers the curve the sales followed", () => {
    const c = fitSalesCurve(calibrationPoints(rows, [a.history, b.history]))!;
    expect(c.b).toBeCloseTo(-1, 1);
    expect(curveMonthly(c, 10000)).toBeCloseTo(60, 0);
    expect(c.r2).toBeGreaterThan(0.99);
    expect(c.books).toBe(2);
    const e = estimateMonthlySales(10000, c)!;
    expect(e.method).toMatch(/your_books/);
    expect(e.interval95[0]).toBeLessThanOrEqual(e.value);
    // The generic curve would have said 300.
    expect(estimateMonthlySales(10000)!.value).toBe(300);
    const niche = summarizeNiche([{ bsr: 10000, price: 9.99, reviews: 10 } as Observation], c);
    expect(niche.estMonthlyUnits!.value).toBe(60);
  });

  it("refuses to fit too few points or a curve where better rank sells less", () => {
    const pts = calibrationPoints(rows, [a.history, b.history]);
    expect(fitSalesCurve(pts.slice(0, MIN_POINTS - 1))).toBeNull();
    const upside = pts.map((p) => ({ ...p, unitsPerDay: p.bsr / 1000 }));
    expect(fitSalesCurve(upside)).toBeNull();
  });
});

describe("matching sales to books", () => {
  it("reads ISBN-13s as the ASIN Amazon gives the paperback", () => {
    expect(isbn13to10("978-0-306-40615-7")).toBe("0306406152");
    expect(isbn13to10("9791234567896")).toBeNull();
    expect(asinOf(" b0d1234567 ")).toBe("B0D1234567");
    expect(asinOf("n/a")).toBe("");
  });

  it("prefers the ASIN, then the exact title", () => {
    const projects = [
      { id: "1", title: "Sudoku Volume 1", name: "a", asin: "B0D1234567" },
      { id: "2", title: "Sample Gratitude Journal", name: "b" },
    ];
    expect(projectForSale({ title: "Renamed On Amazon", asin: "B0D1234567" }, projects)?.id).toBe("1");
    expect(projectForSale({ title: "sample gratitude journal", asin: "B0ZZZZZZZZ" }, projects)?.id).toBe("2");
    expect(projectForSale({ title: "Unknown", asin: "" }, projects)).toBeUndefined();
  });
});
