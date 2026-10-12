"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bleedArea, interiorGeometry, isRecto, safeArea } from "@/lib/kdp/geometry";
import { generatorInfo, type GeneratorKind } from "@/lib/generators/pages";
import { cloneElement } from "@/lib/schema/elements";
import type { Element, Page } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";
import { newId, ptToIn, round } from "@/lib/util/ids";
import type { Guide } from "@/components/editor/CanvasEditor";
import { ElementStudio } from "@/components/editor/ElementStudio";
import { AddPagesDialog } from "./AddPagesDialog";
import { PageThumb } from "./PageThumb";
import { PrintSettingsDialog } from "./PrintSettingsDialog";
import type { Focus } from "./Workspace";

export function InteriorTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [addOpen, setAddOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const pages = project.interior.pages;
  const index = Math.min(focus.pageIndex, Math.max(0, pages.length - 1));
  const page = pages[index];
  const g = useMemo(() => interiorGeometry(project.spec, pages.length), [project.spec, pages.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);

  const guides = useMemo<Guide[]>(() => {
    const safe = safeArea(g, index);
    const out: Guide[] = [{ box: { x: 0, y: 0, width: g.trimW, height: g.trimH }, color: "#6b6b6b", label: "Trim" }];
    if (g.bleed) out.push({ box: bleedArea(g, index), color: "#d32f2f", dash: [5, 4], label: "Bleed" });
    out.push({ box: safe, color: "#0f6e63", dash: [4, 4], label: `Live area (gutter ${round(ptToIn(g.gutter))}" on ${isRecto(index) ? "left" : "right"})` });
    return out;
  }, [g, index]);

  const view = useMemo(() => {
    const pad = 18;
    const paper = bleedArea(g, index);
    return { paper, safe: safeArea(g, index), world: { x: paper.x - pad, y: paper.y - pad, width: paper.width + pad * 2, height: paper.height + pad * 2 } };
  }, [g, index]);

  if (!page)
    return (
      <div className="empty">
        <p>This book has no pages yet.</p>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          Add pages
        </button>
        <AddPagesDialog open={addOpen} onClose={() => setAddOpen(false)} project={project} currentIndex={0} onInsert={(p, at, extra) => insertPages(p, at, extra)} />
      </div>
    );

  function insertPages(newPages: Page[], at: number, extra: { assets: typeof project.assets; runs: typeof project.modelRuns }) {
    update((d) => {
      d.interior.pages.splice(at, 0, ...newPages);
      d.assets.push(...extra.assets);
      d.modelRuns.push(...extra.runs);
    });
    setFocus({ pageIndex: at, elementId: null });
  }

  const setElements = (els: Element[], opts?: { silent?: boolean }) =>
    update(
      (d) => {
        d.interior.pages[index].elements = els;
      },
      { history: !opts?.silent },
    );

  const pageOp = (op: "dup" | "del" | "up" | "down" | "blank") => {
    update((d) => {
      const ps = d.interior.pages;
      if (op === "dup") ps.splice(index + 1, 0, { ...structuredClone(ps[index]), id: newId("pg"), elements: ps[index].elements.map((e) => cloneElement(e as Element)) });
      if (op === "blank") ps.splice(index + 1, 0, { id: newId("pg"), elements: [] });
      if (op === "del") ps.splice(index, 1);
      if (op === "up" && index > 0) [ps[index - 1], ps[index]] = [ps[index], ps[index - 1]];
      if (op === "down" && index < ps.length - 1) [ps[index + 1], ps[index]] = [ps[index], ps[index + 1]];
    });
    const nextIndex = op === "dup" || op === "blank" || op === "down" ? Math.min(index + 1, pages.length) : op === "up" ? Math.max(0, index - 1) : Math.max(0, Math.min(index, pages.length - 2));
    setFocus({ pageIndex: nextIndex, elementId: null });
  };

  const kind = page.generator?.kind;
  const kindLabel = kind ? (generatorInfo(kind.replace(/-solutions$/, "") as GeneratorKind)?.label ?? kind) : "Custom";

  const left = (
    <div className="studio-col">
      <div className="studio-col-head">
        <strong style={{ fontSize: 13 }}>{pages.length} pages</strong>
        <button className="btn btn-sm btn-primary" onClick={() => setAddOpen(true)}>
          + Add
        </button>
      </div>
      <div className="studio-col-body" ref={listRef}>
        <div className="page-list" role="listbox" aria-label="Pages">
          {pages.map((p, i) => (
            <button
              key={p.id}
              data-index={i}
              className="page-thumb-btn"
              role="option"
              aria-selected={i === index}
              aria-current={i === index}
              onClick={() => setFocus({ pageIndex: i, elementId: null })}
            >
              <PageThumb elements={p.elements} widthPt={g.trimW} heightPt={g.trimH} assets={project.assets} px={120} alt={`Page ${i + 1}`} />
              <span>
                {i + 1}
                {p.label ? ` · ${p.label}` : ""}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const rightTop = (
    <div className="studio-col-head" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div className="row-between">
        <strong>
          Page {index + 1} <span className="muted">({isRecto(index) ? "right-hand" : "left-hand"})</span>
        </strong>
        <span className="badge">{kindLabel}</span>
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => pageOp("up")} disabled={index === 0} aria-label="Move page earlier">
          ↑
        </button>
        <button className="btn btn-sm" onClick={() => pageOp("down")} disabled={index === pages.length - 1} aria-label="Move page later">
          ↓
        </button>
        <button className="btn btn-sm" onClick={() => pageOp("dup")}>
          Duplicate
        </button>
        <button className="btn btn-sm" onClick={() => pageOp("blank")}>
          + Blank
        </button>
        <button className="btn btn-sm btn-danger" onClick={() => pageOp("del")}>
          Delete
        </button>
      </div>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={!page.hideNumber}
            disabled={!project.interior.pageNumbers.enabled}
            onChange={(e) =>
              update((d) => {
                d.interior.pages[index].hideNumber = !e.target.checked;
              })
            }
          />
          Page number
        </label>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setPrintOpen(true)}>
          Print settings…
        </button>
      </div>
    </div>
  );

  return (
    <>
      <ElementStudio
        key={page.id}
        project={project}
        elements={page.elements}
        setElements={setElements}
        addAssets={(assets) =>
          update((d) => {
            d.assets.push(...assets);
          })
        }
        world={view.world}
        paper={view.paper}
        background="#ffffff"
        guides={guides}
        liveArea={view.safe}
        label={`Page ${index + 1}`}
        left={left}
        rightTop={rightTop}
        selectedId={focus.elementId}
        onSelect={(id) => setFocus({ pageIndex: index, elementId: id })}
      />
      <AddPagesDialog open={addOpen} onClose={() => setAddOpen(false)} project={project} currentIndex={index} onInsert={insertPages} />
      <PrintSettingsDialog open={printOpen} onClose={() => setPrintOpen(false)} project={project} />
    </>
  );
}
