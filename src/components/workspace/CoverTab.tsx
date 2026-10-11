"use client";

import { useMemo, useState } from "react";
import { buildCover, COVER_TEMPLATES, PALETTES } from "@/lib/cover/templates";
import { coverGeometry } from "@/lib/kdp/geometry";
import type { Element } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";
import { ptToIn, round } from "@/lib/util/ids";
import type { Guide } from "@/components/editor/CanvasEditor";
import { ElementStudio } from "@/components/editor/ElementStudio";

export function firstParagraph(s: string, max = 420): string {
  const p = s.split(/\n\s*\n/)[0]?.trim() ?? "";
  return p.length > max ? `${p.slice(0, max).replace(/\s+\S*$/, "")}…` : p;
}

export function CoverTab({ focusId }: { focusId: string | null }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [selected, setSelected] = useState<string | null>(focusId);
  const [templateId, setTemplateId] = useState(project.cover.templateId ?? "band");
  const [paletteId, setPaletteId] = useState(PALETTES[0].id);
  const n = project.interior.pages.length;
  const cg = useMemo(() => coverGeometry(project.spec, n), [project.spec, n]);

  const [prevFocus, setPrevFocus] = useState(focusId);
  if (focusId !== prevFocus) {
    setPrevFocus(focusId);
    setSelected(focusId);
  }

  const guides = useMemo<Guide[]>(() => {
    const out: Guide[] = [
      { box: cg.back, color: "#6b6b6b", label: "Trim" },
      { box: cg.front, color: "#6b6b6b" },
      { box: cg.spineBox, color: "#3558a8", label: `Spine ${round(ptToIn(cg.spine), 3)}"` },
      { box: cg.backSafe, color: "#0f6e63", dash: [4, 4], label: "Safe zone" },
      { box: cg.frontSafe, color: "#0f6e63", dash: [4, 4] },
    ];
    if (cg.spineTextAllowed) out.push({ box: cg.spineSafe, color: "#0f6e63", dash: [2, 3] });
    if (project.cover.barcode === "kdp") out.push({ box: cg.barcode, color: "#e65100", fill: "rgba(255,255,255,0.85)", label: "Barcode" });
    return out;
  }, [cg, project.cover.barcode]);

  const view = useMemo(() => {
    const pad = 24;
    const paper = { x: 0, y: 0, width: cg.width, height: cg.height };
    return { paper, world: { x: -pad, y: -pad, width: cg.width + pad * 2, height: cg.height + pad * 2 } };
  }, [cg]);

  const rebuild = () => {
    const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
    const m = project.metadata;
    const cover = buildCover(templateId, { title: m.title || project.name, subtitle: m.subtitle, author: m.author, backText: firstParagraph(m.description), palette }, cg);
    const aiListing = project.modelRuns.some((r) => r.outputs.some((o) => o.startsWith("listing.")));
    update((d) => {
      d.cover.background = cover.background;
      d.cover.templateId = cover.templateId;
      d.cover.elements = cover.elements.map((el) =>
        aiListing && el.type === "text" && (el.name === "Back blurb" || el.name === "Subtitle") ? { ...el, provenance: { origin: "ai-generated" as const } } : el,
      ) as Element[];
    });
    setSelected(null);
  };

  const rightTop = (
    <div className="studio-col-head" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <div className="row-between">
        <strong>Full-wrap cover</strong>
        <span className="badge">
          {round(ptToIn(cg.width), 3)}" × {round(ptToIn(cg.height), 3)}"
        </span>
      </div>
      <div className="field">
        <label>
          Template
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {COVER_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}: {t.description}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="chip-list" role="radiogroup" aria-label="Palette">
        {PALETTES.map((p) => (
          <button key={p.id} className="chip" role="radio" aria-checked={paletteId === p.id} onClick={() => setPaletteId(p.id)} style={{ borderColor: paletteId === p.id ? "var(--accent)" : undefined }}>
            <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: p.bg, border: `3px solid ${p.accent}` }} />
            {p.name}
          </button>
        ))}
      </div>
      <button className="btn btn-sm btn-primary" onClick={rebuild}>
        Build cover from listing
      </button>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Uses title, subtitle, author and the first paragraph of the description. Replaces the current cover design (undo is available).
      </p>
      <div className="row">
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input
            type="color"
            aria-label="Background color"
            value={project.cover.background}
            onChange={(e) =>
              update((d) => {
                d.cover.background = e.target.value;
              })
            }
          />
          <span>Background</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={project.cover.barcode === "kdp"}
            onChange={(e) =>
              update((d) => {
                d.cover.barcode = e.target.checked ? "kdp" : "own";
              })
            }
          />
          KDP prints the barcode
        </label>
      </div>
      {!cg.spineTextAllowed && <div className="notice notice-info">Spine text needs 80+ pages; this book has {n}.</div>}
    </div>
  );

  return (
    <ElementStudio
      project={project}
      elements={project.cover.elements}
      setElements={(els, opts) =>
        update(
          (d) => {
            d.cover.elements = els;
          },
          { history: !opts?.silent },
        )
      }
      addAssets={(assets) =>
        update((d) => {
          d.assets.push(...assets);
        })
      }
      world={view.world}
      paper={view.paper}
      background={project.cover.background}
      guides={guides}
      liveArea={cg.frontSafe}
      label="Cover"
      rightTop={rightTop}
      selectedId={selected}
      onSelect={setSelected}
    />
  );
}
