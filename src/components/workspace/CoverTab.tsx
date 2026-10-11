"use client";

import { useEffect, useMemo, useState } from "react";
import { designCover } from "@/lib/cover/artClient";
import { coverBadge } from "@/lib/cover/inside";
import { isSavedTemplateId, SAVED_TEMPLATE_PREFIX, type SavedCoverTemplate } from "@/lib/cover/library";
import { PALETTES, templateInfo } from "@/lib/cover/templates";
import { getCoverTemplate } from "@/lib/storage/coverTemplates";
import { coverGeometry } from "@/lib/kdp/geometry";
import type { Project } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";
import { ptToIn, round } from "@/lib/util/ids";
import type { Guide } from "@/components/editor/CanvasEditor";
import { ElementStudio } from "@/components/editor/ElementStudio";
import { CoverArtPanel } from "./CoverArtPanel";
import { TemplateLibraryDialog } from "./TemplateLibrary";

export function firstParagraph(s: string, max = 420): string {
  const p = s.split(/\n\s*\n/)[0]?.trim() ?? "";
  return p.length > max ? `${p.slice(0, max).replace(/\s+\S*$/, "")}…` : p;
}

export function CoverTab({ focusId }: { focusId: string | null }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [selected, setSelected] = useState<string | null>(focusId);
  const [templateId, setTemplateId] = useState(project.cover.templateId ?? "band");
  const [paletteId, setPaletteId] = useState(project.cover.paletteId ?? PALETTES[0].id);
  const [inside, setInside] = useState(true);
  const [thumbs, setThumbs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saved, setSaved] = useState<SavedCoverTemplate | null>(null);
  /** Badge text; undefined follows the book (e.g. its puzzle count). */
  const [badge, setBadge] = useState<string | undefined>(project.cover.badge);
  const autoBadge = coverBadge(project);
  const n = project.interior.pages.length;
  const cg = useMemo(() => coverGeometry(project.spec, n), [project.spec, n]);

  // A cover built from a saved template rebuilds from that template.
  useEffect(() => {
    if (!isSavedTemplateId(templateId) || saved?.id === templateId.slice(SAVED_TEMPLATE_PREFIX.length)) return;
    getCoverTemplate(templateId.slice(SAVED_TEMPLATE_PREFIX.length)).then((t) => setSaved(t ?? null));
  }, [templateId, saved]);

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

  /**
   * Lay out the cover. `candidateId` puts that artwork on it (switching to its
   * art layout if needed); `use` picks a built-in or saved template first.
   */
  const rebuild = async (candidateId?: string, use?: { templateId: string } | { saved: SavedCoverTemplate }) => {
    const current = useProjectStore.getState().project!;
    const candidate = current.coverArt?.candidates.find((c) => c.id === (candidateId ?? current.coverArt?.chosenId));
    const chosen = use && "saved" in use ? `${SAVED_TEMPLATE_PREFIX}${use.saved.id}` : use?.templateId;
    // Art is generated for one layout, so using a candidate switches to it.
    const tpl = candidateId && candidate ? candidate.layout : (chosen ?? templateId);
    if (tpl !== templateId) setTemplateId(tpl);
    const savedTpl = use && "saved" in use ? use.saved : isSavedTemplateId(tpl) ? saved : null;
    if (use && "saved" in use) setSaved(use.saved);
    const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0];
    const aiListing = current.modelRuns.some((r) => r.outputs.some((o) => o.startsWith("listing.")));
    setError(null);
    setWarnings([]);
    if (isSavedTemplateId(tpl) && !savedTpl) {
      setError("That saved template is no longer in your library. Pick another design.");
      return;
    }
    setBusy(true);
    try {
      const next = await designCover(current, {
        templateId: tpl,
        palette,
        backText: firstParagraph(current.metadata.description),
        candidateId: candidate?.id,
        inside,
        thumbs,
        aiListing,
        badge,
        ...(savedTpl ? { saved: savedTpl } : {}),
        onWarnings: setWarnings,
      });
      applyCover(next);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const applyCover = (next: Project) =>
    update((d) => {
      d.assets = next.assets;
      d.cover = next.cover;
      d.coverArt = next.coverArt;
    });

  const rightTop = (
    <div className="studio-col-head" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
      <div className="row-between">
        <strong>Full-wrap cover</strong>
        <span className="badge">
          {round(ptToIn(cg.width), 3)}" × {round(ptToIn(cg.height), 3)}"
        </span>
      </div>
      <div className="template-current">
        <div style={{ flex: 1 }}>
          <small className="muted">Template</small>
          <div>
            <strong>{isSavedTemplateId(templateId) ? (saved?.name ?? "Saved template") : (templateInfo(templateId)?.name ?? templateId)}</strong>
            {isSavedTemplateId(templateId) && <span className="badge" style={{ marginLeft: 6 }}>My template</span>}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setLibraryOpen(true)}>
          Browse template library
        </button>
      </div>
      <TemplateLibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        project={project}
        palette={PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]}
        onPalette={setPaletteId}
        busy={busy}
        onUse={(id) => {
          setLibraryOpen(false);
          rebuild(undefined, { templateId: id });
        }}
        onUseSaved={(t) => {
          setLibraryOpen(false);
          rebuild(undefined, { saved: t });
        }}
      />
      <div className="chip-list" role="radiogroup" aria-label="Palette">
        {PALETTES.map((p) => (
          <button key={p.id} className="chip" role="radio" aria-checked={paletteId === p.id} onClick={() => setPaletteId(p.id)} style={{ borderColor: paletteId === p.id ? "var(--accent)" : undefined }}>
            <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: p.bg, border: `3px solid ${p.accent}` }} />
            {p.name}
          </button>
        ))}
      </div>
      {templateId === "series" && <small className="muted">The series name and volume number come from the listing&apos;s Series field, e.g. &ldquo;Brain Breaks, Book 2&rdquo;.</small>}
      {(isSavedTemplateId(templateId) || templateInfo(templateId)?.usesBadge) && (
        <label className="field">
          Badge text
          <input value={badge ?? autoBadge} placeholder="e.g. 200 puzzles, Large print" maxLength={28} onChange={(e) => setBadge(e.target.value)} />
        </label>
      )}
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} />
          &ldquo;What&apos;s inside&rdquo; list
        </label>
        <label className="check">
          <input type="checkbox" checked={thumbs} onChange={(e) => setThumbs(e.target.checked)} />
          Page thumbnails on the back
        </label>
      </div>
      <button className="btn btn-sm btn-primary" onClick={() => rebuild()} disabled={busy}>
        {busy && <span className="spinner" />} Build cover from listing
      </button>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        Uses title, subtitle, author and the first paragraph of the description. Replaces the current cover design (undo is available).
      </p>
      {error && <div className="notice notice-fail">{error}</div>}
      {warnings.map((w) => (
        <div key={w} className="notice notice-warn">
          {w}
        </div>
      ))}
      <CoverArtPanel onUse={(id) => rebuild(id)} busy={busy} palette={PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]} />
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
