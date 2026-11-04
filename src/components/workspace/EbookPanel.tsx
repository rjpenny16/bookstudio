"use client";

import { useEffect, useState } from "react";
import { buildEbook, kindleCreateProject } from "@/lib/export/ebook";
import { downloadBlob, slug } from "@/lib/export/package";
import { bytesToMb, ebookRoyalty } from "@/lib/kdp/ebook";
import { EBOOK_IMAGE_PRESETS, EBOOK_ROYALTY_US, FILL_IN_TYPES, MOSTLY_BLANK_TYPES, type EbookImagePreset } from "@/lib/kdp/rules-ebook";
import { ebookLayoutDefault, storyWords } from "@/lib/export/ebookBlocks";
import { measuredEbookMb } from "@/lib/preflight/ebook";
import { browserFontLoader } from "@/lib/render/fonts";
import { renderInteriorPdf } from "@/lib/render/pdf";
import { editionDraft, editionOf } from "@/lib/schema/formats";
import { useProjectStore } from "@/lib/storage/store";
import { round } from "@/lib/util/ids";

interface Built {
  layout: "fixed" | "text";
  omitted: string[];
  epub: Blob;
  cover: Blob;
  coverUrl: string;
  pageWidth: number;
  pageHeight: number;
}

/**
 * The Kindle eBook edition: a fixed-layout EPUB with one image per page, built in the
 * browser. Building it measures the file, which sets the 70% delivery fee, so this panel
 * compares both royalty rates at the eBook price and recommends one.
 */
export function EbookPanel() {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const e = editionOf(project, "ebook");
  const [built, setBuilt] = useState<Built | null>(null);
  const [progress, setProgress] = useState<{ label: string; f: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => void (built && URL.revokeObjectURL(built.coverUrl)), [built]);

  if (!e.enabled) return null;

  const name = slug(project.metadata.title || project.name);
  const preset: EbookImagePreset = e.ebookImage ?? "standard";
  const layoutDefault = ebookLayoutDefault(project);
  const layout = e.ebookLayout ?? layoutDefault;
  const words = storyWords(project);
  const mb = measuredEbookMb(project);
  const price = e.listPriceUsd;
  const r = price != null ? ebookRoyalty(price, mb ?? 0) : null;
  const plan = e.royaltyPlan ?? r?.best ?? "70";
  const set = (fn: (d: ReturnType<typeof editionDraft>) => void) =>
    update((d) => {
      fn(editionDraft(d, "ebook"));
    });

  const build = async () => {
    setError(null);
    setProgress({ label: "Rendering eBook pages", f: 0 });
    try {
      const b = await buildEbook(project, preset, (label, f) => setProgress({ label, f }), layout);
      if (built) URL.revokeObjectURL(built.coverUrl);
      setBuilt({ layout: b.layout, omitted: b.omitted, epub: new Blob([b.epub as BlobPart], { type: "application/epub+zip" }), cover: b.cover, coverUrl: URL.createObjectURL(b.cover), pageWidth: b.pageWidth, pageHeight: b.pageHeight });
      set((d) => void (d.ebookSize = { bytes: b.epub.byteLength, pages: b.pages, image: preset, layout: b.layout }));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="card stack" id="ebook">
      <h2 style={{ margin: 0 }}>Kindle eBook</h2>
      <p className="muted" style={{ margin: 0 }}>
        Built from this book&rsquo;s pages and the front of the paperback cover. No ISBN is needed.
      </p>
      {MOSTLY_BLANK_TYPES.includes(project.bookType) ? (
        <div className="notice notice-warn">Mostly blank books make poor eBooks, and KDP may reject them. Consider print formats only for this book.</div>
      ) : (
        FILL_IN_TYPES.includes(project.bookType) && (
          <div className="notice notice-warn">Kindle readers can&rsquo;t write in an eBook. Say so in the eBook description, for example &ldquo;view or print the pages&rdquo;, to avoid returns and bad reviews.</div>
        )
      )}
      <label className="field">
        Layout
        <select value={e.ebookLayout ?? ""} onChange={(ev) => set((d) => void (ev.target.value ? (d.ebookLayout = ev.target.value as "fixed" | "text") : delete d.ebookLayout))}>
          <option value="">{layoutDefault === "text" ? "Text (suggested for this book)" : "Fixed (suggested for this book)"}</option>
          <option value="text">Text: the story reflows; puzzles are pictures</option>
          <option value="fixed">Fixed: every page is a picture</option>
        </select>
        <span className="field-hint">
          {layout === "text"
            ? `Readers can resize and search the ${words.toLocaleString()} words of prose; puzzles, answer keys and other grids stay as pictures, and pages for writing are left out. Text eBooks are much smaller, so the 70% delivery fee is low.`
            : "Every page looks exactly like the print book. Best for puzzle, activity and journal books; readers can't resize the text."}
        </span>
      </label>
      <div className="field-row">
        <label className="field">
          {layout === "text" ? "Puzzle image size" : "Page image size"}
          <select value={preset} onChange={(ev) => set((d) => void (d.ebookImage = ev.target.value as EbookImagePreset))}>
            <option value="standard">Standard ({EBOOK_IMAGE_PRESETS.standard} px, smaller file)</option>
            <option value="sharp">Sharp ({EBOOK_IMAGE_PRESETS.sharp} px, for fine puzzle detail)</option>
          </select>
        </label>
        <label className="field">
          Royalty rate
          <select value={e.royaltyPlan ?? ""} onChange={(ev) => set((d) => void (ev.target.value ? (d.royaltyPlan = ev.target.value as "70" | "35") : delete d.royaltyPlan))}>
            <option value="">Whichever pays more{r ? ` (${r.best}%)` : ""}</option>
            <option value="70">70% (${EBOOK_ROYALTY_US.highMinUsd} to ${EBOOK_ROYALTY_US.highMaxUsd}, delivery fee)</option>
            <option value="35">35%</option>
          </select>
        </label>
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={!!progress} onClick={build}>
          {built || mb != null ? "Rebuild eBook" : "Build eBook"}
        </button>
        <span className="field-hint">Building measures the file size, which sets the 70% delivery fee.</span>
      </div>
      {progress && (
        <div className="stack" aria-live="polite">
          <span className="muted" style={{ fontSize: 12 }}>
            <span className="spinner" /> {progress.label}…
          </span>
          <div className="progress">
            <div style={{ width: `${Math.round(progress.f * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <div className="notice notice-fail">{error}</div>}
      <div className="grid grid-3">
        <div className="stat">
          <span className="stat-label">File size</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {mb != null ? `${round(mb, 1)} MB` : "Not built"}
          </span>
          <span className="stat-sub">
            {project.interior.pages.length} pages{built ? `, ${built.pageWidth} × ${built.pageHeight} px` : ""}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">70% royalty</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {r ? (r.seventy.eligible ? `$${r.seventy.royaltyUsd.toFixed(2)}` : "Not allowed") : "Set a price"}
          </span>
          <span className="stat-sub">{r ? (r.seventy.eligible ? `after $${r.seventy.deliveryUsd.toFixed(2)} delivery${mb == null ? " (estimate: build to measure)" : ""}` : `needs $${EBOOK_ROYALTY_US.highMinUsd} to $${EBOOK_ROYALTY_US.highMaxUsd}`) : "in the Formats table above"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">35% royalty</span>
          <span className="stat-value" style={{ fontSize: 18 }}>
            {r ? `$${r.thirtyFive.royaltyUsd.toFixed(2)}` : "Set a price"}
          </span>
          <span className="stat-sub">{r ? `lowest price at this size $${r.thirtyFive.minPriceUsd.toFixed(2)}` : ""}</span>
        </div>
      </div>
      {r && (
        <div className={`notice ${plan === r.best ? "notice-pass" : "notice-warn"}`}>
          {r.best === "70" ? `70% pays more at $${price!.toFixed(2)}.` : `35% pays more at $${price!.toFixed(2)}${r.seventy.eligible ? ` (the delivery fee on ${round(mb ?? 0, 1)} MB outweighs the higher rate)` : ""}.`}
          {plan !== r.best && ` You chose ${plan}%.`}
        </div>
      )}
      {built?.layout === "text" && built.omitted.length > 0 && (
        <div className="notice notice-info">Left out of the text eBook (nobody can write on a Kindle): {built.omitted.join(", ")}.</div>
      )}
      {built && <img src={built.coverUrl} alt="Kindle eBook cover" style={{ width: 160, border: "1px solid var(--line)", borderRadius: 4 }} />}
      <div className="row">
        <button className="btn" disabled={!built} onClick={() => built && downloadBlob(built.epub, `${name}.epub`)}>
          book.epub
        </button>
        <button className="btn" disabled={!built} onClick={() => built && downloadBlob(built.cover, `${name}-kindle-cover.jpg`)}>
          cover.jpg
        </button>
        <button
          className="btn"
          disabled={!!progress}
          onClick={async () => {
            setProgress({ label: "Rendering Kindle Create PDF", f: 0 });
            try {
              const bytes = await renderInteriorPdf(kindleCreateProject(project), { loadFont: browserFontLoader, onProgress: (d, t) => setProgress({ label: "Rendering Kindle Create PDF", f: d / t }) });
              downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${name}-kindle-create-source.pdf`);
            } finally {
              setProgress(null);
            }
          }}
        >
          kindle-create-source.pdf
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        Upload book.epub to KDP and check it in the Kindle Previewer. If KDP turns it down, import kindle-create-source.pdf into Kindle Create as a print replica and upload what it saves. The full package includes an ebook/ folder with all three.
      </p>
      {mb != null && bytesToMb(e.ebookSize!.bytes) > 0 && e.ebookSize!.image !== preset && <div className="notice notice-warn">The size shown is for the {e.ebookSize!.image} image size. Rebuild to measure {preset}.</div>}
    </div>
  );
}
