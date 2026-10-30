import { describe, expect, it } from "vitest";
import { dfsItems, parseKeywordData, parseVolumes, type DfsResponse } from "@/lib/market/dataforseo";
import { isBook, keepaDate, keepaMinuteToMs, rankHistory, toMarketProduct, type KeepaProduct } from "@/lib/market/keepa";

// Shapes follow Keepa's api_backend Product class and DataForSEO's TypeScriptClient models.
const book: KeepaProduct = {
  asin: "B0TESTBOOK",
  title: "Large Print Sudoku for Seniors",
  author: "A. Puzzler",
  binding: "Paperback",
  rootCategory: 283155,
  numberOfPages: 124,
  publicationDate: 20250409,
  monthlySold: 300,
  images: [{ l: "81abc.jpg", m: "51abc.jpg" }],
  // csv slots: 0 Amazon, 1 new, 3 sales rank, 4 list price, 16 rating, 17 review count
  csv: [[7000000, 899], null, null, [7000000, 52000, 7001440, -1, 7002880, 48000], [7000000, 999], ...Array(11).fill(null), [7000000, 46], [7000000, 312]],
  stats: { current: [899, 899, -1, 45000, 999] },
};

describe("Keepa parsing", () => {
  it("reads a book's current numbers", () => {
    const p = toMarketProduct(book);
    expect(p).toMatchObject({ asin: "B0TESTBOOK", bsr: 45000, price: 9.99, reviews: 312, rating: 4.6, pages: 124, publishedAt: "2025-04-09", monthlySold: 300 });
    expect(p.imageUrl).toBe("https://m.media-amazon.com/images/I/81abc.jpg");
  });

  it("falls back to the Amazon price and to history when stats are missing", () => {
    const p = toMarketProduct({ asin: "X", csv: [[1, 1299]], stats: null });
    expect(p.price).toBe(12.99);
    expect(p.bsr).toBeNull();
    expect(p.rating).toBeNull();
    expect(p.pages).toBeNull();
  });

  it("converts Keepa minutes and dates", () => {
    expect(new Date(keepaMinuteToMs(0)).toISOString()).toBe("2011-01-01T00:00:00.000Z");
    expect(keepaDate(200301)).toBe("2003-01");
    expect(keepaDate(-1)).toBe("");
  });

  it("reads rank history without the gaps", () => {
    const h = rankHistory(book);
    expect(h.map((x) => x.rank)).toEqual([52000, 48000]);
    expect(h[1].t - h[0].t).toBe(2880 * 60_000);
  });

  it("keeps books and drops other products", () => {
    expect(isBook(book)).toBe(true);
    expect(isBook({ asin: "T", rootCategory: 165793011, binding: "Toy" })).toBe(false);
    expect(isBook({ asin: "U", binding: "Spiral-bound" })).toBe(true);
  });
});

const envelope = (items: unknown[], extra: Record<string, unknown> = {}): DfsResponse => ({
  status_code: 20000,
  status_message: "Ok.",
  cost: 0.01,
  tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.01, result: [{ items: items as never, ...extra }] }],
});

describe("DataForSEO parsing", () => {
  it("reads bulk search volumes", () => {
    expect(parseVolumes(envelope([{ keyword: "sudoku", search_volume: 40500 }, { keyword: "rare thing", search_volume: null }]))).toEqual([
      { keyword: "sudoku", volume: 40500, source: "dataforseo" },
      { keyword: "rare thing", volume: null, source: "dataforseo" },
    ]);
  });

  it("reads related and ranked keyword data", () => {
    const r = envelope([{ keyword_data: { keyword: "large print sudoku", keyword_info: { search_volume: 9900 } }, ranked_serp_element: { serp_item: { rank_absolute: 3 } } }, { keyword_data: null }]);
    expect(parseKeywordData(r)).toEqual([{ keyword: "large print sudoku", volume: 9900, source: "dataforseo" }]);
  });

  it("turns a failed task into an error", () => {
    expect(() => dfsItems({ status_code: 40100, status_message: "You are not authorized." })).toThrow(/not authorized/);
    expect(() => dfsItems({ status_code: 20000, tasks: [{ status_code: 40501, status_message: "Invalid Field" }] })).toThrow(/Invalid Field/);
  });
});
