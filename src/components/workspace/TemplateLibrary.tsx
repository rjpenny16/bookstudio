"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { coverWords } from "@/lib/cover/artClient";
import { seriesName } from "@/lib/cover/inside";
import { captureCoverTemplate, isSavedTemplateId, SAVED_TEMPLATE_PREFIX, type SavedCoverTemplate } from "@/lib/cover/library";
import { ART_COVER_TEMPLATES, buildCover, COVER_TEMPLATES, PALETTES, TEMPLATE_TAGS, type CoverTemplate, type Palette, type TemplateTag } from "@/lib/cover/templates";
import { coverGeometry, type CoverGeometry } from "@/lib/kdp/geometry";
import { ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import type { Asset, Element, Project } from "@/lib/schema/project";
import { deleteCoverTemplate, downloadCoverTemplate, importCoverTemplate, listCoverTemplates, saveCoverTemplate } from "@/lib/storage/coverTemplates";
import { ptToIn, round } from "@/lib/util/ids";

type Shelf = "all" | TemplateTag | "art" | "mine";

const PREVIEW_PX = 180;

/** Front panel of a cover as an image. */
async function frontPreview(cg: CoverGeometry, background: string, elements: Element[], assets: Asset[], px = PREVIEW_PX, type: "image/png" | "image/jpeg" = "image/png"): Promise<string> {
  await ensureFonts();
  const images = assets.length ? await loadImages(assets) : new Map();
  const canvas = rasterize({ widthPt: cg.trimW, heightPt: cg.trimH, scale: px / cg.trimW, background, elements, images, originX: -cg.front.x, originY: -cg.front.y });
  return canvas.toDataURL(type, 0.85);
}

export function TemplateLibraryDialog(props: {
  open: boolean;
  onClose: () => void;
  project: Project;
  palette: Palette;
  onPalette: (id: string) => void;
  /** Lay out a built-in template with the current palette. */
  onUse: (templateId: string) => void;
  onUseSaved: (t: SavedCoverTemplate) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className="modal modal-wide" onClose={props.onClose} aria-labelledby="library-title">
      {props.open && <Library {...props} />}
    </dialog>
  );
}

function Library({ onClose, project, palette, onPalette, onUse, onUseSaved, busy }: Parameters<typeof TemplateLibraryDialog>[0]) {
  const [shelf, setShelf] = useState<Shelf>("all");
  const [saved, setSaved] = useState<SavedCoverTemplate[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [name, setName] = useState(project.metadata.series ? seriesName(project.metadata.series) : project.metadata.title || project.name);
  const [message, setMessage] = useState<{ kind: "pass" | "fail"; text: string } | null>(null);
  const n = project.interior.pages.length;
  const cg = useMemo(() => coverGeometry(project.spec, n), [project.spec, n]);
  const art = project.coverArt?.candidates.find((c) => c.id === project.coverArt?.chosenId) ?? project.coverArt?.candidates[0];
  const current = project.cover.templateId;

  useEffect(() => {
    listCoverTemplates().then(setSaved, () => setSaved([]));
  }, []);

  // Preview every built-in design with this book's words and the chosen palette.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const input = { ...coverWords(project), backText: "", palette };
      const artAsset: Asset | null = art
        ? { id: "preview-art", name: "preview", mime: "image/png", dataUrl: art.dataUrl, widthPx: art.widthPx, heightPx: art.heightPx, origin: "ai-generated", license: { license: "", author: "", source: "", commercialUse: true }, contentHash: "", createdAt: "" }
        : null;
      const out: Record<string, string> = {};
      for (const t of [...COVER_TEMPLATES, ...ART_COVER_TEMPLATES]) {
        const isArt = ART_COVER_TEMPLATES.includes(t);
        if (isArt && !artAsset) continue;
        const c = buildCover(t.id, { ...input, ...(isArt && artAsset ? { art: { assetId: artAsset.id } } : {}) }, cg);
        out[t.id] = await frontPreview(cg, c.background, c.elements, isArt && artAsset ? [artAsset] : []);
        if (cancelled) return;
      }
      setPreviews(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [project, palette, cg, art]);

  const counts = useMemo(() => {
    const c: Partial<Record<Shelf, number>> = { all: COVER_TEMPLATES.length, art: ART_COVER_TEMPLATES.length, mine: saved?.length ?? 0 };
    for (const t of COVER_TEMPLATES) for (const tag of t.tags) c[tag] = (c[tag] ?? 0) + 1;
    return c;
  }, [saved]);

  const shown: CoverTemplate[] = shelf === "art" ? ART_COVER_TEMPLATES : shelf === "all" ? COVER_TEMPLATES : shelf === "mine" ? [] : COVER_TEMPLATES.filter((t) => t.tags.includes(shelf));

  const saveCurrent = async () => {
    setMessage(null);
    try {
      const preview = await frontPreview(cg, project.cover.background, project.cover.elements, project.assets, 240, "image/jpeg");
      const t = captureCoverTemplate(project, cg, name, preview);
      await saveCoverTemplate(t);
      setSaved(await listCoverTemplates());
      setShelf("mine");
      setMessage({ kind: "pass", text: `Saved "${t.name}". Open any other project's Cover tab to apply it.` });
    } catch (e) {
      setMessage({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    try {
      const t = await importCoverTemplate(file);
      setSaved(await listCoverTemplates());
      setShelf("mine");
      setMessage({ kind: "pass", text: `Imported "${t.name}".` });
    } catch (e) {
      setMessage({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const remove = async (t: SavedCoverTemplate) => {
    if (!window.confirm(`Delete the template "${t.name}"? Covers already built from it stay as they are.`)) return;
    await deleteCoverTemplate(t.id);
    setSaved(await listCoverTemplates());
  };

  const shelves: { id: Shelf; label: string }[] = [{ id: "all", label: "All designs" }, ...TEMPLATE_TAGS, { id: "art", label: "With cover art" }, { id: "mine", label: "My templates" }];

  return (
    <>
      <div className="modal-head">
        <div>
          <h2 id="library-title" style={{ margin: 0 }}>
            Cover template library
          </h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            Previews use this book&apos;s title and the palette below. Save a finished cover to &ldquo;My templates&rdquo; to reuse it across a series.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body stack">
        <div className="chip-list" role="tablist" aria-label="Template shelves">
          {shelves.map((s) => (
            <button key={s.id} role="tab" aria-selected={shelf === s.id} className="chip" onClick={() => setShelf(s.id)} style={{ borderColor: shelf === s.id ? "var(--accent)" : undefined, fontWeight: shelf === s.id ? 600 : undefined }}>
              {s.label} <span className="muted">{counts[s.id] ?? 0}</span>
            </button>
          ))}
        </div>
        {shelf !== "mine" && (
          <div className="chip-list" role="radiogroup" aria-label="Preview palette">
            {PALETTES.map((p) => (
              <button key={p.id} className="chip" role="radio" aria-checked={palette.id === p.id} onClick={() => onPalette(p.id)} style={{ borderColor: palette.id === p.id ? "var(--accent)" : undefined }}>
                <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: p.bg, border: `3px solid ${p.accent}` }} />
                {p.name}
              </button>
            ))}
          </div>
        )}
        {message && (
          <div className={`notice notice-${message.kind}`} role="status">
            {message.text}
          </div>
        )}

        {shelf === "art" && !art && <div className="notice notice-info">These layouts are built around AI cover art. Generate art in the Cover tab first (needs an image provider in Settings).</div>}

        {shelf !== "mine" ? (
          <ul className="template-grid" aria-label="Templates">
            {shown.map((t) => {
              const disabled = ART_COVER_TEMPLATES.includes(t) && !art;
              return (
                <li key={t.id} className="template-card" aria-label={t.name}>
                  <div className="template-thumb" style={{ ["--ratio" as string]: `${cg.trimW / cg.trimH}` }}>
                    {previews[t.id] ? <img src={previews[t.id]} alt={`${t.name} preview`} /> : <span className="muted">{disabled ? "Needs cover art" : "Rendering…"}</span>}
                  </div>
                  <div className="row-between">
                    <strong>{t.name}</strong>
                    {current === t.id && <span className="badge badge-info">Current</span>}
                  </div>
                  <small className="muted">{t.description}</small>
                  {t.tags.length > 0 && <small className="muted">{t.tags.map((g) => TEMPLATE_TAGS.find((x) => x.id === g)?.label).join(" · ")}</small>}
                  <button className="btn btn-sm btn-primary" disabled={busy || disabled} onClick={() => onUse(t.id)} aria-label={`Use ${t.name}`}>
                    Use this design
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <>
            <div className="card stack" style={{ padding: 12 }}>
              <strong>Save this book&apos;s cover as a template</strong>
              <small className="muted">
                Keeps the design, colors, fonts and images. The title, subtitle, author, series, badge, back blurb, &ldquo;What&apos;s inside&rdquo;, page thumbnails and spine are filled in from each book you apply it to, and the layout is resized to that book&apos;s trim and spine.
              </small>
              <div className="row">
                <label className="field" style={{ flex: 1 }}>
                  Template name
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
                </label>
                <button className="btn btn-sm btn-primary" style={{ alignSelf: "flex-end" }} onClick={saveCurrent} disabled={!project.cover.elements.length}>
                  Save current cover
                </button>
              </div>
              <label className="btn btn-sm" style={{ alignSelf: "flex-start" }}>
                Import template file…
                <input type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
              </label>
            </div>
            {saved === null ? (
              <p className="muted">Loading…</p>
            ) : saved.length === 0 ? (
              <p className="muted">No saved templates yet. Design a cover you like, then save it here to reuse it on your next book.</p>
            ) : (
              <ul className="template-grid" aria-label="My templates">
                {saved.map((t) => (
                  <li key={t.id} className="template-card" aria-label={t.name}>
                    <div className="template-thumb" style={{ ["--ratio" as string]: `${t.source.trimW / t.source.trimH}` }}>
                      {t.preview ? <img src={t.preview} alt={`${t.name} preview`} /> : <span className="muted">No preview</span>}
                    </div>
                    <div className="row-between">
                      <strong>{t.name}</strong>
                      {current === `${SAVED_TEMPLATE_PREFIX}${t.id}` && <span className="badge badge-info">Current</span>}
                    </div>
                    <small className="muted">
                      Saved for {round(ptToIn(t.source.trimW), 2)}&quot; × {round(ptToIn(t.source.trimH), 2)}&quot; · {new Date(t.createdAt).toLocaleDateString()}
                      {t.assets.length ? ` · ${t.assets.length} image${t.assets.length === 1 ? "" : "s"}` : ""}
                    </small>
                    <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onUseSaved(t)} aria-label={`Apply ${t.name}`}>
                      Apply to this book
                    </button>
                    <div className="row">
                      <button className="btn btn-sm" onClick={() => downloadCoverTemplate(t)} aria-label={`Download ${t.name}`}>
                        Download
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="modal-foot">
        {isSavedTemplateId(current) || !current ? null : <small className="muted" style={{ marginRight: "auto", alignSelf: "center" }}>Current: {[...COVER_TEMPLATES, ...ART_COVER_TEMPLATES].find((t) => t.id === current)?.name ?? current}</small>}
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
