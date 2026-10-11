"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";
import type { Box } from "@/lib/kdp/geometry";
import { effectiveDpi } from "@/lib/preflight";
import { cloneElement, ellipse, image, line, pattern, rect, text } from "@/lib/schema/elements";
import type { Asset, Element, Project } from "@/lib/schema/project";
import { fileToAsset } from "@/lib/storage/assets";
import { inToPt } from "@/lib/util/ids";
import type { Guide } from "./CanvasEditor";
import { ElementPanel } from "./ElementPanel";

const CanvasEditor = dynamic(() => import("./CanvasEditor"), {
  ssr: false,
  loading: () => (
    <div className="studio-col" style={{ flex: 1, display: "grid", placeItems: "center" }}>
      <span className="muted">
        <span className="spinner" /> Loading editor…
      </span>
    </div>
  ),
});

interface Props {
  project: Project;
  elements: Element[];
  setElements: (els: Element[], opts?: { silent?: boolean }) => void;
  addAssets: (assets: Asset[]) => void;
  world: Box;
  paper: Box;
  background: string;
  guides: Guide[];
  /** Where new elements are placed. */
  liveArea: Box;
  label: string;
  left?: ReactNode;
  rightTop?: ReactNode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function ElementStudio(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { liveArea: a } = p;
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;

  const add = (el: Element) => {
    p.setElements([...p.elements, { ...el, provenance: { origin: "human" } }]);
    p.onSelect(el.id);
  };
  const update = (el: Element) => p.setElements(p.elements.map((e) => (e.id === el.id ? el : e)));
  const remove = (id: string) => {
    p.setElements(p.elements.filter((e) => e.id !== id));
    p.onSelect(null);
  };
  const duplicate = (id: string) => {
    const src = p.elements.find((e) => e.id === id);
    if (!src) return;
    const copy = cloneElement(src, 9, 9);
    const idx = p.elements.indexOf(src);
    p.setElements([...p.elements.slice(0, idx + 1), copy, ...p.elements.slice(idx + 1)]);
    p.onSelect(copy.id);
  };
  const reorder = (id: string, to: "up" | "down" | "top" | "bottom") => {
    const els = [...p.elements];
    const i = els.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [el] = els.splice(i, 1);
    const j = to === "top" ? els.length : to === "bottom" ? 0 : to === "up" ? Math.min(els.length, i + 1) : Math.max(0, i - 1);
    els.splice(j, 0, el);
    p.setElements(els);
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      const assets = await Promise.all([...files].map((f) => fileToAsset(f)));
      p.addAssets(assets);
      const els = assets.map((asset, k) => {
        // Place at 300 DPI when it fits, otherwise fit the live area.
        let w = (asset.widthPx / 300) * 72;
        let h = (asset.heightPx / 300) * 72;
        const s = Math.min(1, a.width / w, a.height / h);
        w *= s;
        h *= s;
        return image({ x: cx - w / 2 + k * 9, y: cy - h / 2 + k * 9, width: w, height: h, assetId: asset.id, provenance: { origin: "user-upload" } });
      });
      p.setElements([...p.elements, ...els]);
      p.onSelect(els[els.length - 1].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={`studio${p.left ? "" : " no-pages"}`}>
      {p.left}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
        <div className="studio-col" style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 0, flex: "none" }}>
          <div className="canvas-toolbar" role="toolbar" aria-label="Add elements">
            <button className="btn btn-sm" onClick={() => add(text({ x: cx - 108, y: cy - 12, width: 216, text: "Double-click to edit", fontSize: 18, align: "center" }))}>
              + Text
            </button>
            <button className="btn btn-sm" onClick={() => add(rect({ x: cx - 72, y: cy - 36, width: 144, height: 72, fill: "#e8e2d6", stroke: "#1d1c1a", strokeWidth: 1 }))}>
              + Rectangle
            </button>
            <button className="btn btn-sm" onClick={() => add(ellipse({ x: cx - 45, y: cy - 45, width: 90, height: 90, fill: "#cfe6e1", stroke: null }))}>
              + Ellipse
            </button>
            <button className="btn btn-sm" onClick={() => add(line({ x: a.x, y: cy, width: a.width, height: 0, stroke: "#1d1c1a", strokeWidth: 1 }))}>
              + Line
            </button>
            <button className="btn btn-sm" onClick={() => add(pattern({ x: a.x, y: cy, width: a.width, height: Math.min(a.height / 2, inToPt(3)), pattern: { kind: "lines", spacing: inToPt(0.3125) }, stroke: "#8c8c8c", strokeWidth: 0.5 }))}>
              + Lines
            </button>
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
              + Image
            </button>
            <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
            {error && <span className="badge badge-fail">{error}</span>}
          </div>
        </div>
        <CanvasEditor
          world={p.world}
          paper={p.paper}
          background={p.background}
          elements={p.elements}
          assets={p.project.assets}
          guides={p.guides}
          selectedId={p.selectedId}
          onSelect={p.onSelect}
          onChange={p.setElements}
          onDelete={remove}
          onDuplicate={duplicate}
          label={p.label}
        />
      </div>
      <div className="studio-col">
        {p.rightTop}
        <div className="studio-col-body">
          <ElementPanel
            elements={p.elements}
            selectedId={p.selectedId}
            onSelect={p.onSelect}
            onUpdate={update}
            onReorder={reorder}
            onDelete={remove}
            onDuplicate={duplicate}
            dpiOf={(el) => effectiveDpi(p.project, el)}
          />
        </div>
      </div>
    </div>
  );
}
