"use client";

import { useEffect, useRef, useState } from "react";
import { spineWidthIn } from "@/lib/kdp/geometry";
import { isValidPaperInk, pageRange, TRIM_SIZES } from "@/lib/kdp/rules";
import { FONTS } from "@/lib/render/fonts";
import { changeSpec } from "@/lib/schema/rescale";
import type { InteriorInk, Paper, PrintSpec, Project } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";

export function PrintSettingsDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="print-title">
      {open && <PrintSettingsForm project={project} onClose={onClose} />}
    </dialog>
  );
}

function PrintSettingsForm({ onClose, project }: { onClose: () => void; project: Project }) {
  const replace = useProjectStore((s) => s.replace);
  const update = useProjectStore((s) => s.update);
  const [spec, setSpec] = useState<PrintSpec>(project.spec);
  const [scale, setScale] = useState(true);
  const [pn, setPn] = useState(project.interior.pageNumbers);

  const n = project.interior.pages.length;
  const range = pageRange(spec.ink, spec.paper);
  const trimChanged = spec.trimId !== project.spec.trimId;

  const apply = () => {
    const next = changeSpec(project, spec, scale);
    replace(next);
    update((d) => {
      d.interior.pageNumbers = pn;
    });
    onClose();
  };

  return (
    <>
      <div className="modal-head">
        <h2 id="print-title" style={{ margin: 0 }}>
          Print settings
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body stack">
        <div className="field-row">
          <div className="field">
            <label>
              Trim size
              <select value={spec.trimId} onChange={(e) => setSpec({ ...spec, trimId: e.target.value })}>
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
              Interior ink
              <select value={spec.ink} onChange={(e) => setSpec({ ...spec, ink: e.target.value as InteriorInk, paper: e.target.value === "black" ? spec.paper : "white" })}>
                <option value="black">Black & white</option>
                <option value="standard-color">Standard color</option>
                <option value="premium-color">Premium color</option>
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Paper
              <select value={spec.paper} onChange={(e) => setSpec({ ...spec, paper: e.target.value as Paper })}>
                <option value="white">White</option>
                <option value="cream" disabled={spec.ink !== "black"}>
                  Cream (black ink only)
                </option>
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Cover finish
              <select value={spec.coverFinish} onChange={(e) => setSpec({ ...spec, coverFinish: e.target.value as PrintSpec["coverFinish"] })}>
                <option value="matte">Matte</option>
                <option value="glossy">Glossy</option>
              </select>
            </label>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={spec.bleed} onChange={(e) => setSpec({ ...spec, bleed: e.target.checked })} />
          <span>
            Interior bleed: print to the page edge (adds 0.125" outside and 0.25" height; outside margins become 0.375")
          </span>
        </label>
        {trimChanged && (
          <label className="check">
            <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} /> Scale existing pages and cover to the new trim size
          </label>
        )}
        {!isValidPaperInk(spec.paper, spec.ink) && <div className="notice notice-fail">Cream paper is only available with black ink.</div>}
        <div className="notice notice-info">
          {n} pages → spine {spineWidthIn(spec, n).toFixed(4)}". Allowed page count for this paper/ink: {range.min}–{range.max}.
        </div>
        <hr />
        <h3>Page numbers</h3>
        <label className="check">
          <input type="checkbox" checked={pn.enabled} onChange={(e) => setPn({ ...pn, enabled: e.target.checked })} /> Show page numbers (bottom center, inside the live area)
        </label>
        <div className="field-row">
          <div className="field">
            <label>
              Start on page
              <input type="number" min={1} value={pn.startAt} onChange={(e) => setPn({ ...pn, startAt: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          </div>
          <div className="field">
            <label>
              Font
              <select value={pn.fontFamily} onChange={(e) => setPn({ ...pn, fontFamily: e.target.value })}>
                {FONTS.map((f) => (
                  <option key={f.family}>{f.family}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              Size (pt)
              <input type="number" min={6} max={16} step={0.5} value={pn.fontSize} onChange={(e) => setPn({ ...pn, fontSize: Number(e.target.value) || 9 })} />
            </label>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={apply} disabled={!isValidPaperInk(spec.paper, spec.ink)}>
          Apply
        </button>
      </div>
    </>
  );
}
