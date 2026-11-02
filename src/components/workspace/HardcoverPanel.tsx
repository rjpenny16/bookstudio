"use client";

import { useEffect, useMemo, useState } from "react";
import { coverImages } from "@/lib/export/client";
import { downloadBlob, slug } from "@/lib/export/package";
import { coverGeometry, coverSizeDiffIn, printCostUsd, royaltyUsd } from "@/lib/kdp/geometry";
import { COVER_SIZE_TOLERANCE_IN, HARDCOVER_COVER } from "@/lib/kdp/rules-hardcover";
import { canvasToBlob } from "@/lib/render/canvas";
import { browserFontLoader } from "@/lib/render/fonts";
import { renderCoverPdf } from "@/lib/render/pdf";
import { editionDraft, editionOf } from "@/lib/schema/formats";
import { hardcoverProject, hardcoverReady } from "@/lib/schema/hardcover";
import { useProjectStore } from "@/lib/storage/store";
import { round } from "@/lib/util/ids";

const inches = (pt: number, d = 3) => round(pt / 72, d);

/**
 * The hardcover edition: whether this book can be one, its cover (always laid out from the
 * paperback cover, so edits to that cover carry over), the size check against KDP's own
 * cover calculator, and its cost.
 */
export function HardcoverPanel() {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const e = editionOf(project, "hardcover");
  const n = project.interior.pages.length;
  const ready = hardcoverReady(project);
  const hc = useMemo(() => hardcoverProject(project), [project]);
  const cg = coverGeometry(hc.spec, n);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: e.coverCheck?.widthIn?.toString() ?? "", h: e.coverCheck?.heightIn?.toString() ?? "" });

  useEffect(() => {
    if (!e.enabled || !ready.ok) return;
    let cancelled = false;
    let url: string | null = null;
    const t = setTimeout(async () => {
      const { full } = await coverImages(hc);
      if (cancelled) return;
      url = URL.createObjectURL(await canvasToBlob(full));
      setPreviewUrl(url);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
  }, [hc, e.enabled, ready.ok]);

  if (!e.enabled) return null;

  const saveSize = (w: string, h: string) => {
    setSize({ w, h });
    const widthIn = Number(w);
    const heightIn = Number(h);
    update((d) => {
      const ed = editionDraft(d, "hardcover");
      if (widthIn > 0 && heightIn > 0) ed.coverCheck = { widthIn, heightIn, pages: n, adopt: ed.coverCheck?.adopt };
      else delete ed.coverCheck;
    });
  };
  const check = e.coverCheck;
  const diff = check && check.pages === n ? coverSizeDiffIn(hc.spec, check) : null;
  const price = e.listPriceUsd;
  const r = price != null && ready.ok ? royaltyUsd(hc.spec, n, price) : null;

  return (
    <div className="card stack" id="hardcover">
      <h2 style={{ margin: 0 }}>Hardcover</h2>
      {!ready.ok ? (
        <div className="notice notice-fail">
          This book can&rsquo;t be a KDP hardcover as it is:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {ready.reasons.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            A case-laminate hardcover with the paperback&rsquo;s interior. Its cover is laid out from the paperback cover onto the boards, with text kept off the hinge, so edit the cover on the Cover tab and both formats update.
          </p>
          <div className="grid grid-3">
            <div className="stat">
              <span className="stat-label">Cover with wrap</span>
              <span className="stat-value" style={{ fontSize: 18 }}>
                {inches(cg.width)}&quot; × {inches(cg.height)}&quot;
              </span>
              <span className="stat-sub">spine {inches(cg.spine)}&quot;</span>
            </div>
            <div className="stat">
              <span className="stat-label">Printing cost</span>
              <span className="stat-value" style={{ fontSize: 18 }}>
                ${printCostUsd(hc.spec, n).toFixed(2)}
              </span>
              <span className="stat-sub">{n} pages, {hc.spec.ink === "black" ? "black ink" : "premium color"}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Royalty</span>
              <span className="stat-value" style={{ fontSize: 18 }}>
                {r ? `$${r.royalty.toFixed(2)}` : "Set a price"}
              </span>
              <span className="stat-sub">{r ? `${Math.round(r.rate * 100)}% at $${price!.toFixed(2)}; minimum $${r.minListPrice.toFixed(2)}` : "in the Formats table above"}</span>
            </div>
          </div>
          <fieldset className="stack" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, margin: 0 }}>
            <legend style={{ fontWeight: 700, fontSize: 13 }}>Check against KDP&rsquo;s cover calculator</legend>
            <p className="field-hint" style={{ margin: 0 }}>
              Published hardcover measurements disagree (the wrap is given as 0.51&quot; and as {HARDCOVER_COVER.wrapIn}&quot;), so BookStudio checks its cover against KDP&rsquo;s own numbers. In KDP&rsquo;s cover calculator, choose Hardcover, {hc.spec.widthIn}&quot; × {hc.spec.heightIn}&quot;, {hc.spec.paper} paper, {hc.spec.ink === "black" ? "black ink" : "premium color"} and {n} pages, then type the full cover size it gives.
            </p>
            <div className="field-row">
              <label className="field">
                KDP cover width (in)
                <input type="number" min={0} step={0.001} value={size.w} onChange={(ev) => saveSize(ev.target.value, size.h)} />
              </label>
              <label className="field">
                KDP cover height (in)
                <input type="number" min={0} step={0.001} value={size.h} onChange={(ev) => saveSize(size.w, ev.target.value)} />
              </label>
            </div>
            {check && check.pages !== n && <div className="notice notice-warn">That size was for {check.pages} pages; the book now has {n}. Enter KDP&rsquo;s size for {n} pages.</div>}
            {diff != null && diff <= COVER_SIZE_TOLERANCE_IN && <div className="notice notice-pass">BookStudio&rsquo;s cover matches KDP&rsquo;s size{check?.adopt ? " (boards sized from it)" : ""}.</div>}
            {diff != null && diff > COVER_SIZE_TOLERANCE_IN && (
              <div className="notice notice-fail">
                BookStudio&rsquo;s cover is {round(diff, 3)}&quot; off KDP&rsquo;s.{" "}
                <button className="btn btn-sm" onClick={() => update((d) => void (editionDraft(d, "hardcover").coverCheck!.adopt = true))}>
                  Use KDP&rsquo;s cover size
                </button>
              </div>
            )}
            {check?.adopt && (
              <label className="check">
                <input type="checkbox" checked onChange={() => update((d) => void delete editionDraft(d, "hardcover").coverCheck!.adopt)} />
                <span>Size the boards from KDP&rsquo;s numbers (untick to use BookStudio&rsquo;s defaults)</span>
              </label>
            )}
          </fieldset>
          {previewUrl ? <img src={previewUrl} alt="Hardcover cover, full wrap" style={{ width: "100%", maxHeight: 320, objectFit: "contain", border: "1px solid var(--line)", borderRadius: 6, background: "var(--panel-2)" }} /> : <div className="empty">Rendering hardcover cover…</div>}
          <div className="row">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const bytes = await renderCoverPdf(hc, { loadFont: browserFontLoader });
                  downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${slug(project.metadata.title || project.name)}-hardcover-cover.pdf`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Hardcover cover.pdf
            </button>
            <span className="field-hint">The full package (Download KDP package) includes a hardcover/ folder with this cover and the interior.</span>
          </div>
        </>
      )}
    </div>
  );
}
