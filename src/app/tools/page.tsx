"use client";

import { useState } from "react";
import { coverGeometry, findTrim, gutterIn, outsideMarginIn, printCostUsd, royaltyUsd, spineWidthIn } from "@/lib/kdp/geometry";
import { GUTTER_TABLE, pageRange, RULES_VERSION, TRIM_SIZES } from "@/lib/kdp/rules";
import type { InteriorInk, Paper, PrintSpec } from "@/lib/schema/project";
import { ptToIn, round } from "@/lib/util/ids";

export default function Tools() {
  const [trimId, setTrimId] = useState("6x9");
  const [pages, setPages] = useState(120);
  const [paper, setPaper] = useState<Paper>("white");
  const [ink, setInk] = useState<InteriorInk>("black");
  const [bleed, setBleed] = useState(false);
  const [price, setPrice] = useState(9.99);
  const trim = findTrim(trimId)!;
  const spec: PrintSpec = { marketplace: "amazon-kdp", binding: "paperback", trimId, widthIn: trim.widthIn, heightIn: trim.heightIn, bleed, paper, ink, coverFinish: "matte", rulesVersion: RULES_VERSION };
  const cg = coverGeometry(spec, pages);
  const r = royaltyUsd(spec, pages, price);
  const range = pageRange(ink, paper);
  const inches = (pt: number, d = 3) => `${round(ptToIn(pt), d)}"`;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>KDP calculators</h1>
          <p>Every number here comes from the same versioned rule set ({RULES_VERSION}) that drives the editor, preflight and the AI agent, so they can never disagree.</p>
        </div>
      </div>
      <div className="card stack">
        <div className="field-row">
          <div className="field">
            <label>
              Trim
              <select value={trimId} onChange={(e) => setTrimId(e.target.value)}>
                {TRIM_SIZES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Pages
              <input type="number" min={1} max={900} value={pages} onChange={(e) => setPages(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          </div>
          <div className="field">
            <label>
              Ink
              <select value={ink} onChange={(e) => { setInk(e.target.value as InteriorInk); if (e.target.value !== "black") setPaper("white"); }}>
                <option value="black">Black & white</option>
                <option value="standard-color">Standard color</option>
                <option value="premium-color">Premium color</option>
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Paper
              <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                <option value="white">White</option>
                <option value="cream" disabled={ink !== "black"}>Cream</option>
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              List price (USD)
              <input type="number" min={0} step={0.01} value={price} onChange={(e) => setPrice(Number(e.target.value) || 0)} />
            </label>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={bleed} onChange={(e) => setBleed(e.target.checked)} /> Interior bleed
        </label>
        {(pages < range.min || pages > range.max) && <div className="notice notice-fail">KDP allows {range.min}–{range.max} pages for this paper and ink.</div>}
      </div>

      <div className="grid grid-3" style={{ marginTop: 14 }}>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Cover</h2>
          <table className="table">
            <tbody>
              <tr><td>Full cover (with bleed)</td><td className="num">{inches(cg.width)} × {inches(cg.height)}</td></tr>
              <tr><td>Spine width</td><td className="num">{spineWidthIn(spec, pages).toFixed(4)}"</td></tr>
              <tr><td>Bleed</td><td className="num">0.125" all sides</td></tr>
              <tr><td>Front panel starts at</td><td className="num">{inches(cg.front.x)}</td></tr>
              <tr><td>Spine text</td><td className="num">{cg.spineTextAllowed ? "Allowed" : "Needs 80+ pages"}</td></tr>
              <tr><td>Barcode area</td><td className="num">2" × 1.2", 0.25" from spine and bottom</td></tr>
              <tr><td>Cover at 300 DPI</td><td className="num">{Math.round(ptToIn(cg.width) * 300)} × {Math.round(ptToIn(cg.height) * 300)} px</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Interior</h2>
          <table className="table">
            <tbody>
              <tr><td>Page size in PDF</td><td className="num">{bleed ? `${round(trim.widthIn + 0.125)}" × ${round(trim.heightIn + 0.25)}"` : `${trim.widthIn}" × ${trim.heightIn}"`}</td></tr>
              <tr><td>Inside (gutter) margin</td><td className="num">≥ {gutterIn(pages)}"</td></tr>
              <tr><td>Outside, top, bottom</td><td className="num">≥ {outsideMarginIn(bleed)}"</td></tr>
              <tr><td>Page count range</td><td className="num">{range.min}–{range.max}</td></tr>
            </tbody>
          </table>
          <h3>Gutter by page count</h3>
          <table className="table">
            <tbody>
              {GUTTER_TABLE.map((g, i) => (
                <tr key={g.maxPages} style={pages <= g.maxPages && (i === 0 || pages > GUTTER_TABLE[i - 1].maxPages) ? { background: "var(--accent-soft)" } : undefined}>
                  <td>{i === 0 ? 24 : GUTTER_TABLE[i - 1].maxPages + 1}–{g.maxPages} pages</td>
                  <td className="num">{g.gutterIn}"</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Royalty (amazon.com)</h2>
          <table className="table">
            <tbody>
              <tr><td>Printing cost</td><td className="num">${printCostUsd(spec, pages).toFixed(2)}</td></tr>
              <tr><td>Royalty rate</td><td className="num">{Math.round(r.rate * 100)}%</td></tr>
              <tr><td>Royalty per sale</td><td className="num" style={{ color: r.royalty < 0 ? "var(--fail)" : undefined }}>${r.royalty.toFixed(2)}</td></tr>
              <tr><td>Expanded Distribution</td><td className="num">${r.expandedRoyalty.toFixed(2)}</td></tr>
              <tr><td>Minimum list price</td><td className="num">${r.minListPrice.toFixed(2)}</td></tr>
            </tbody>
          </table>
          <p className="field-hint" style={{ margin: 0 }}>
            60% at $9.99+, 50% below; royalty = rate × price − printing cost. Printing costs are KDP&apos;s published US rates and change over time: confirm on KDP before pricing.
          </p>
        </div>
      </div>
    </div>
  );
}
