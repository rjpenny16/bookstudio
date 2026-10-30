import { describe, expect, it } from "vitest";
import { charm, floorPrice, priceBand, recommendPrice } from "@/lib/kdp/pricing";
import type { PrintSpec } from "@/lib/schema/project";

const spec = (over: Partial<PrintSpec> = {}): PrintSpec => ({
  marketplace: "amazon-kdp", binding: "paperback", trimId: "6x9", widthIn: 6, heightIn: 9, bleed: false,
  paper: "white", ink: "black", coverFinish: "matte", rulesVersion: "test", ...over,
});

describe("pricing", () => {
  it("rounds to prices ending in .99", () => {
    expect(charm(8.5)).toBe(8.99);
    expect(charm(7.95)).toBe(7.99);
    expect(charm(12.2)).toBe(11.99);
    expect(charm(0.2)).toBe(0.99);
  });

  it("measures the middle half of competitor prices and ignores missing ones", () => {
    expect(priceBand([7.99, null, 8.99])).toBeNull();
    const b = priceBand([5.99, 7.99, 8.99, 9.99, 12.99, null, 0])!;
    expect(b.n).toBe(5);
    expect(b.median).toBe(8.99);
    expect(b.low).toBe(7.99);
    expect(b.high).toBe(9.99);
  });

  it("keeps a copy earning at least $1 after printing", () => {
    // 120 black pages on 6x9 cost $2.44 to print: $6.99 at 50% earns $1.06.
    expect(floorPrice(spec(), 120)).toBe(6.99);
    // 200 premium-color pages cost $14: only a 60% price clears it, and $24.99 earns $0.99.
    expect(floorPrice(spec({ ink: "premium-color" }), 200)).toBe(25.99);
  });

  it("prices at the competitor median", () => {
    const r = recommendPrice(spec(), 120, { competitorPrices: [6.99, 7.49, 7.99, 7.99, 8.25] });
    expect(r.price).toBe(7.99);
    expect(r.band?.median).toBe(7.99);
    expect(r.reason).toMatch(/comparable books/);
  });

  it("raises a price just under $9.99 to the 60% royalty when competitors charge that much", () => {
    const r = recommendPrice(spec(), 120, { competitorPrices: [7.99, 8.99, 8.99, 9.99, 11.99] });
    expect(r.price).toBe(9.99);
    expect(r.rate).toBe(0.6);
    expect(r.reason).toMatch(/50% to 60%/);
  });

  it("doesn't raise to $9.99 when the market tops out below it", () => {
    const r = recommendPrice(spec(), 120, { competitorPrices: [7.99, 8.49, 8.99, 8.99, 8.99] });
    expect(r.price).toBe(8.99);
    expect(r.rate).toBe(0.5);
  });

  it("uses the suggestion without market data, then the threshold rule", () => {
    expect(recommendPrice(spec(), 120, { suggested: 6.5 }).price).toBe(6.99);
    expect(recommendPrice(spec(), 120, { suggested: 8.99 }).price).toBe(9.99);
    expect(recommendPrice(spec(), 120).price).toBe(9.99);
  });

  it("never goes below the floor, and says so when the floor is above the market", () => {
    const r = recommendPrice(spec({ ink: "premium-color" }), 200, { competitorPrices: [9.99, 12.99, 14.99, 15.99] });
    expect(r.price).toBe(25.99);
    expect(r.royalty).toBeGreaterThanOrEqual(1);
    expect(r.reason).toMatch(/above most competitors/);
  });
});
