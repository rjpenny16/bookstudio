import { describe, expect, it } from "vitest";
import { coverGeometry, gutterIn, interiorGeometry, printCostUsd, royaltyUsd, safeArea, spineWidthIn } from "@/lib/kdp/geometry";
import type { PrintSpec } from "@/lib/schema/project";
import { ptToIn } from "@/lib/util/ids";

const spec = (over: Partial<PrintSpec> = {}): PrintSpec => ({
  marketplace: "amazon-kdp", binding: "paperback", trimId: "6x9", widthIn: 6, heightIn: 9, bleed: false,
  paper: "white", ink: "black", coverFinish: "matte", rulesVersion: "test", ...over,
});

describe("KDP geometry", () => {
  it("computes spine width per paper", () => {
    expect(spineWidthIn(spec(), 120)).toBeCloseTo(0.27024, 5);
    expect(spineWidthIn(spec({ paper: "cream" }), 120)).toBeCloseTo(0.3, 5);
    expect(spineWidthIn(spec({ ink: "premium-color" }), 100)).toBeCloseTo(0.2347, 5);
  });

  it("computes full cover dimensions with bleed", () => {
    const cg = coverGeometry(spec(), 120);
    expect(ptToIn(cg.width)).toBeCloseTo(0.125 * 2 + 6 * 2 + 0.27024, 4);
    expect(ptToIn(cg.height)).toBeCloseTo(9.25, 4);
    expect(cg.spineTextAllowed).toBe(true);
    expect(coverGeometry(spec(), 79).spineTextAllowed).toBe(false);
    // Barcode sits 0.25" from the spine and bottom trim on the back cover.
    expect(ptToIn(cg.barcode.x + cg.barcode.width)).toBeCloseTo(0.125 + 6 - 0.25, 4);
    expect(ptToIn(cg.barcode.y + cg.barcode.height)).toBeCloseTo(0.125 + 9 - 0.25, 4);
  });

  it("uses the gutter table", () => {
    expect(gutterIn(24)).toBe(0.375);
    expect(gutterIn(150)).toBe(0.375);
    expect(gutterIn(151)).toBe(0.5);
    expect(gutterIn(400)).toBe(0.625);
    expect(gutterIn(828)).toBe(0.875);
  });

  it("puts the gutter on the binding side", () => {
    const g = interiorGeometry(spec(), 120);
    const recto = safeArea(g, 0);
    const verso = safeArea(g, 1);
    expect(ptToIn(recto.x)).toBeCloseTo(0.375);
    expect(ptToIn(g.trimW - (verso.x + verso.width))).toBeCloseTo(0.375);
    expect(ptToIn(verso.x)).toBeCloseTo(0.25);
  });

  it("sizes bleed pages", () => {
    const g = interiorGeometry(spec({ bleed: true, widthIn: 8.5, heightIn: 11 }), 100);
    expect(ptToIn(g.pageW)).toBeCloseTo(8.625);
    expect(ptToIn(g.pageH)).toBeCloseTo(11.25);
  });

  it("computes print cost and royalty", () => {
    expect(printCostUsd(spec(), 120)).toBeCloseTo(2.44, 2);
    expect(printCostUsd(spec(), 100)).toBeCloseTo(2.3, 2);
    expect(printCostUsd(spec({ widthIn: 8.5, heightIn: 11 }), 120)).toBeCloseTo(3.04, 2);
    const r = royaltyUsd(spec(), 120, 9.99);
    expect(r.rate).toBe(0.6);
    expect(r.royalty).toBeCloseTo(9.99 * 0.6 - 2.44, 2);
    expect(royaltyUsd(spec(), 120, 7.99).rate).toBe(0.5);
    expect(r.minListPrice).toBeCloseTo(4.88, 2);
  });
});
