"use client";

import { ELEMENT_LABELS, elementLabel } from "@/lib/schema/elements";
import type { Element, PatternSpec } from "@/lib/schema/project";
import { FONTS } from "@/lib/render/fonts";
import { inToPt, ptToIn } from "@/lib/util/ids";
import { NumberField } from "@/components/ui/NumberField";
import { CommitTextarea } from "@/components/ui/CommitTextarea";

interface Props {
  elements: Element[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (el: Element) => void;
  onReorder: (id: string, to: "up" | "down" | "top" | "bottom") => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  dpiOf?: (el: Extract<Element, { type: "image" }>) => number | null;
}

function ColorField({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (v: string | null) => void; allowNone?: boolean }) {
  return (
    <div className="field">
      <span style={{ fontWeight: 600, fontSize: 12, color: "var(--ink-2)" }}>{label}</span>
      <div className="row">
        <input type="color" aria-label={label} value={value ?? "#ffffff"} disabled={value === null} onChange={(e) => onChange(e.target.value)} />
        {allowNone && (
          <label className="check">
            <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : "#000000")} /> None
          </label>
        )}
      </div>
    </div>
  );
}

export function ElementPanel({ elements, selectedId, onSelect, onUpdate, onReorder, onDelete, onDuplicate, dpiOf }: Props) {
  const el = elements.find((e) => e.id === selectedId) ?? null;
  const set = (patch: Partial<Element>) => el && onUpdate({ ...el, ...patch } as Element);
  const inch = (k: "x" | "y" | "width" | "height", label: string) =>
    el && <NumberField label={label} suffix="in" value={ptToIn(el[k])} onCommit={(v) => set({ [k]: inToPt(v) } as Partial<Element>)} min={k === "width" || k === "height" ? (el.type === "line" ? -100 : 0.01) : -100} />;
  const reversed = [...elements].reverse();

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="prop-section">
        <div className="row-between">
          <h3 style={{ margin: 0 }}>Layers</h3>
          <span className="counter">{elements.length}</span>
        </div>
        {elements.length === 0 ? (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Empty page. Use the toolbar to add text, shapes, images or patterns.
          </p>
        ) : (
          <ul className="layer-list" role="listbox" aria-label="Layers, top first">
            {reversed.slice(0, 300).map((e) => (
              <li key={e.id}>
                <button className="layer-item" role="option" aria-selected={e.id === selectedId} onClick={() => onSelect(e.id === selectedId ? null : e.id)}>
                  <span className="layer-type">{ELEMENT_LABELS[e.type]}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{elementLabel(e)}</span>
                  {e.locked && <span className="badge">locked</span>}
                  {e.provenance?.origin === "ai-generated" && <span className="badge badge-info">AI</span>}
                </button>
              </li>
            ))}
            {reversed.length > 300 && <li className="muted" style={{ fontSize: 12 }}>…and {reversed.length - 300} more</li>}
          </ul>
        )}
      </div>

      {!el ? (
        <div className="prop-section">
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Select a layer to edit its position, size and style. Every canvas action is also available here from the keyboard.
          </p>
        </div>
      ) : (
        <>
          <div className="prop-section">
            <div className="row-between">
              <h3 style={{ margin: 0 }}>{ELEMENT_LABELS[el.type]}</h3>
              {el.provenance && el.provenance.origin !== "human" && (
                <span className={`badge ${el.provenance.origin === "ai-generated" ? "badge-info" : ""}`} title="Provenance">
                  {el.provenance.origin === "ai-generated" ? "AI-generated" : el.provenance.origin === "generated" ? "Generated" : "Uploaded"}
                  {el.provenance.humanEdited ? " · edited" : ""}
                </span>
              )}
            </div>
            <div className="row">
              <button className="btn btn-sm" onClick={() => onDuplicate(el.id)}>
                Duplicate
              </button>
              <button className="btn btn-sm" onClick={() => set({ locked: !el.locked })} aria-pressed={!!el.locked}>
                {el.locked ? "Unlock" : "Lock"}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => onDelete(el.id)}>
                Delete
              </button>
            </div>
            <div className="btn-group" role="group" aria-label="Arrange">
              <button className="btn btn-sm" onClick={() => onReorder(el.id, "top")}>To front</button>
              <button className="btn btn-sm" onClick={() => onReorder(el.id, "up")}>Forward</button>
              <button className="btn btn-sm" onClick={() => onReorder(el.id, "down")}>Back</button>
              <button className="btn btn-sm" onClick={() => onReorder(el.id, "bottom")}>To back</button>
            </div>
          </div>

          <div className="prop-section">
            <div className="prop-grid">
              {inch("x", "X")}
              {inch("y", "Y")}
              {inch("width", el.type === "line" ? "Δ X" : "Width")}
              {inch("height", el.type === "line" ? "Δ Y" : "Height")}
              {el.type !== "line" && <NumberField label="Rotation" suffix="°" value={el.rotation} step={1} digits={1} onCommit={(v) => set({ rotation: v })} />}
              <NumberField label="Opacity" suffix="%" value={Math.round((el.opacity ?? 1) * 100)} step={5} digits={0} min={0} max={100} onCommit={(v) => set({ opacity: v / 100 })} />
            </div>
          </div>

          {el.type === "text" && (
            <div className="prop-section">
              <CommitTextarea label="Text" value={el.text} onCommit={(text) => set({ text })} />
              <div className="field">
                <label>
                  Font
                  <select value={el.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
                    {FONTS.map((f) => (
                      <option key={f.family} value={f.family}>
                        {f.label} ({f.category})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="prop-grid">
                <NumberField label="Size" suffix="pt" value={el.fontSize} step={0.5} digits={1} min={4} max={400} onCommit={(v) => set({ fontSize: v })} />
                <NumberField label="Line height" value={el.lineHeight} step={0.05} digits={2} min={0.6} max={3} onCommit={(v) => set({ lineHeight: v })} />
              </div>
              <div className="row">
                <ColorField label="Color" value={el.color} onChange={(v) => set({ color: v ?? "#000000" })} />
                <div className="field">
                  <span style={{ fontWeight: 600, fontSize: 12, color: "var(--ink-2)" }}>Style</span>
                  <div className="row">
                    <button className="btn btn-sm" aria-pressed={el.bold} onClick={() => set({ bold: !el.bold })}>
                      Bold
                    </button>
                    <div className="btn-group" role="group" aria-label="Alignment">
                      {(["left", "center", "right"] as const).map((a) => (
                        <button key={a} className="btn btn-sm" aria-pressed={el.align === a} onClick={() => set({ align: a })}>
                          {a[0].toUpperCase() + a.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(el.type === "rect" || el.type === "ellipse" || el.type === "path") && (
            <div className="prop-section">
              <div className="row">
                <ColorField label="Fill" value={el.fill} allowNone onChange={(v) => set({ fill: v })} />
                <ColorField label="Stroke" value={el.stroke} allowNone onChange={(v) => set({ stroke: v })} />
              </div>
              <div className="prop-grid">
                <NumberField label="Stroke width" suffix="pt" value={el.strokeWidth} step={0.25} digits={2} min={0} onCommit={(v) => set({ strokeWidth: v })} />
                {el.type === "rect" && <NumberField label="Corner radius" suffix="pt" value={el.cornerRadius} step={1} digits={1} min={0} onCommit={(v) => set({ cornerRadius: v })} />}
              </div>
            </div>
          )}

          {el.type === "line" && (
            <div className="prop-section">
              <ColorField label="Stroke" value={el.stroke} onChange={(v) => set({ stroke: v ?? "#000000" })} />
              <div className="prop-grid">
                <NumberField label="Stroke width" suffix="pt" value={el.strokeWidth} step={0.25} digits={2} min={0.1} onCommit={(v) => set({ strokeWidth: v })} />
                <label className="check" style={{ alignSelf: "end" }}>
                  <input type="checkbox" checked={!!el.dash} onChange={(e) => set({ dash: e.target.checked ? [4, 3] : undefined })} /> Dashed
                </label>
              </div>
            </div>
          )}

          {el.type === "pattern" && (
            <div className="prop-section">
              <div className="field">
                <label>
                  Pattern
                  <select
                    value={el.pattern.kind}
                    onChange={(e) => {
                      const kind = e.target.value as PatternSpec["kind"];
                      const defaults: Record<PatternSpec["kind"], PatternSpec> = {
                        lines: { kind: "lines", spacing: inToPt(0.3125) },
                        dots: { kind: "dots", spacing: inToPt(0.25), radius: 0.7 },
                        grid: { kind: "grid", spacing: inToPt(0.25) },
                        handwriting: { kind: "handwriting", rowHeight: inToPt(0.75), gap: inToPt(0.25) },
                        staff: { kind: "staff", staves: 10, lineGap: 7 },
                      };
                      set({ pattern: defaults[kind] });
                    }}
                  >
                    <option value="lines">Ruled lines</option>
                    <option value="dots">Dot grid</option>
                    <option value="grid">Graph grid</option>
                    <option value="handwriting">Handwriting rows</option>
                    <option value="staff">Music staff</option>
                  </select>
                </label>
              </div>
              <div className="prop-grid">
                {"spacing" in el.pattern && (
                  <NumberField label="Spacing" suffix="in" value={ptToIn(el.pattern.spacing)} step={0.0625} min={0.05} onCommit={(v) => set({ pattern: { ...el.pattern, spacing: inToPt(v) } as PatternSpec })} />
                )}
                {el.pattern.kind === "handwriting" && (
                  <NumberField label="Row height" suffix="in" value={ptToIn(el.pattern.rowHeight)} step={0.0625} min={0.2} onCommit={(v) => set({ pattern: { ...el.pattern, rowHeight: inToPt(v) } as PatternSpec })} />
                )}
                {el.pattern.kind === "staff" && <NumberField label="Staves" value={el.pattern.staves} step={1} digits={0} min={1} max={20} onCommit={(v) => set({ pattern: { ...el.pattern, staves: Math.round(v) } as PatternSpec })} />}
                <NumberField label="Line weight" suffix="pt" value={el.strokeWidth} step={0.1} digits={2} min={0.1} onCommit={(v) => set({ strokeWidth: v })} />
              </div>
              <ColorField label="Color" value={el.stroke} onChange={(v) => set({ stroke: v ?? "#999999" })} />
            </div>
          )}

          {el.type === "image" && dpiOf && (
            <div className="prop-section">
              {(() => {
                const dpi = dpiOf(el);
                if (dpi === null) return <div className="notice notice-fail">Image asset missing.</div>;
                const cls = dpi >= 300 ? "pass" : dpi >= 150 ? "warn" : "fail";
                return (
                  <div className={`notice notice-${cls}`}>
                    Effective resolution <b>{Math.round(dpi)} DPI</b>
                    {dpi < 300 ? ". KDP recommends 300 DPI; make the image smaller or use a larger file." : "."}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
