"use client";

import { useEffect, useState } from "react";
import { ART_TEMPLATES, artBox, artDpi, coverCrop, suggestArtTemplate, type ArtTemplateId } from "@/lib/cover/art";
import { directArt, generateCandidates, imageStatus, pickCandidate, type ImageStatus } from "@/lib/cover/artClient";
import { ART_COVER_TEMPLATES, PALETTES, type Palette } from "@/lib/cover/templates";
import { coverGeometry } from "@/lib/kdp/geometry";
import { effectiveDpi } from "@/lib/preflight";
import { useProjectStore } from "@/lib/storage/store";

/** Most candidates kept on a project; older ones are dropped first. */
const KEEP = 8;
const COUNT = 4;

/** Art direction, candidate generation and the gallery on the Cover tab. */
export function CoverArtPanel({ onUse, busy, palette }: { onUse: (candidateId: string) => void; busy: boolean; palette: Palette }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [status, setStatus] = useState<ImageStatus | null>(null);
  const [concepts, setConcepts] = useState<{ name: string; prompt: string }[]>([]);
  const [layout, setLayout] = useState<ArtTemplateId>(suggestArtTemplate(project.bookType));
  const [working, setWorking] = useState<null | "direct" | "generate" | "pick">(null);
  const [message, setMessage] = useState<{ kind: "info" | "fail"; text: string } | null>(null);

  useEffect(() => {
    imageStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const candidates = project.coverArt?.candidates ?? [];
  const chosen = project.coverArt?.chosenId;
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const artEl = project.cover.elements.find((e) => e.type === "image" && e.name === "Cover art");
  const dpi = artEl?.type === "image" ? effectiveDpi(project, artEl) : null;
  const artAsset = artEl?.type === "image" ? project.assets.find((a) => a.id === artEl.assetId) : undefined;

  const run = async <T,>(kind: NonNullable<typeof working>, fn: () => Promise<T>) => {
    setWorking(kind);
    setMessage(null);
    try {
      return await fn();
    } catch (e) {
      setMessage({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWorking(null);
    }
  };

  const suggest = () =>
    run("direct", async () => {
      const { direction, run: r } = await directArt(useProjectStore.getState().project!, COUNT);
      setConcepts(direction.concepts);
      setLayout(direction.layout);
      if (r)
        update((d) => {
          d.modelRuns.push(r);
        });
      setMessage({ kind: "info", text: `Suggested ${direction.concepts.length} concepts for the "${ART_COVER_TEMPLATES.find((t) => t.id === direction.layout)?.name}" layout and the ${PALETTES.find((p) => p.id === direction.palette)?.name} palette.` });
    });

  const generate = () =>
    run("generate", async () => {
      const list = concepts.filter((c) => c.prompt.trim());
      const res = await generateCandidates(list, layout, cg);
      update((d) => {
        const prev = d.coverArt?.candidates ?? [];
        d.coverArt = { ...d.coverArt, candidates: [...res.candidates, ...prev].slice(0, KEEP) };
        d.modelRuns.push(...res.runs);
      });
      setMessage(res.errors.length ? { kind: "fail", text: `${res.candidates.length} image(s) generated; ${res.errors.join("; ")}` } : { kind: "info", text: `${res.candidates.length} new candidate(s). Pick one to put it on the cover.` });
    });

  const pickBest = () =>
    run("pick", async () => {
      const p = useProjectStore.getState().project!;
      const pool = (p.coverArt?.candidates ?? []).filter((c) => c.layout === layout);
      if (!pool.length) throw new Error("No candidates for this layout yet.");
      const pick = await pickCandidate(p, pool, layout, palette);
      update((d) => {
        if (d.coverArt) d.coverArt.pickReason = pick.reason;
        if (pick.run) d.modelRuns.push(pick.run);
      });
      setMessage({ kind: "info", text: `Picked "${pool[pick.index].name}": ${pick.reason}` });
      onUse(pool[pick.index].id);
    });

  if (!status) return null;
  if (!status.configured)
    return (
      <div className="notice notice-info" style={{ fontSize: 12 }}>
        <strong>AI cover art</strong>: set <code>OPENAI_API_KEY</code> on the server to generate artwork for the art templates. See Settings.
      </div>
    );

  return (
    <section className="stack" aria-label="Cover art" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div className="row-between">
        <strong>Cover art</strong>
        <span className="badge badge-pass">{status.model}</span>
      </div>
      <div className="field">
        <label>
          Art layout
          <select value={layout} onChange={(e) => setLayout(e.target.value as ArtTemplateId)}>
            {ART_TEMPLATES.map((id) => (
              <option key={id} value={id}>
                {ART_COVER_TEMPLATES.find((t) => t.id === id)?.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn btn-sm" onClick={suggest} disabled={!!working}>
        {working === "direct" && <span className="spinner" />} Suggest art concepts
      </button>
      {concepts.map((c, i) => (
        <div className="field" key={i}>
          <label>
            Concept {i + 1}: {c.name}
            <textarea rows={3} value={c.prompt} onChange={(e) => setConcepts((cs) => cs.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))} />
          </label>
        </div>
      ))}
      {concepts.length > 0 && (
        <button className="btn btn-sm btn-primary" onClick={generate} disabled={!!working || !concepts.some((c) => c.prompt.trim())}>
          {working === "generate" && <span className="spinner" />} Generate {concepts.filter((c) => c.prompt.trim()).length} image(s)
        </button>
      )}
      <p className="field-hint" style={{ margin: 0 }}>
        Prompts always add: no text or logos in the art, a calm area for the title, a flat illustrated style that prints cleanly. Each image is a paid request to {status.provider}.
      </p>
      {message && <div className={`notice notice-${message.kind}`}>{message.text}</div>}
      {candidates.length > 0 && (
        <>
          <div className="grid grid-2" role="list" aria-label="Cover art candidates" style={{ gap: 8 }}>
            {candidates.map((c) => {
              const box = artBox(c.layout as ArtTemplateId, cg);
              const crop = coverCrop(c.widthPx, c.heightPx, box.width / box.height);
              return (
                <div key={c.id} role="listitem" aria-label={c.name} className="stack" style={{ gap: 4, border: `2px solid ${c.id === chosen ? "var(--accent)" : "var(--line)"}`, borderRadius: 8, padding: 4 }}>
                  <img src={c.dataUrl} alt={`Cover art: ${c.name}`} style={{ width: "100%", aspectRatio: `${c.widthPx} / ${c.heightPx}`, objectFit: "cover", borderRadius: 4 }} />
                  <span style={{ fontSize: 11 }}>
                    {c.name} · {Math.round(artDpi(box, crop.sw))} DPI
                  </span>
                  <button className="btn btn-sm" onClick={() => onUse(c.id)} disabled={busy || !!working}>
                    {c.id === chosen ? "On cover" : "Use this"}
                  </button>
                </div>
              );
            })}
          </div>
          <button className="btn btn-sm" onClick={pickBest} disabled={!!working || busy || !candidates.some((c) => c.layout === layout)}>
            {working === "pick" && <span className="spinner" />} Pick the best for me
          </button>
          {project.coverArt?.pickReason && <p className="field-hint" style={{ margin: 0 }}>Last pick: {project.coverArt.pickReason}</p>}
        </>
      )}
      {dpi !== null && (
        <div className={`notice ${dpi >= 300 ? "notice-pass" : "notice-warn"}`} style={{ fontSize: 12 }}>
          Cover art prints at {Math.round(dpi)} DPI{artAsset?.upscaledFrom ? ` (upscaled from ${artAsset.upscaledFrom.widthPx}×${artAsset.upscaledFrom.heightPx} px to ${artAsset.widthPx}×${artAsset.heightPx})` : ""}. KDP recommends 300.
        </div>
      )}
    </section>
  );
}
