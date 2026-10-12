"use client";

import { useMemo } from "react";
import { coverWords } from "@/lib/cover/artClient";
import { isArtTemplate } from "@/lib/cover/art";
import { buildCover, templateInfo } from "@/lib/cover/templates";
import { variantPalette } from "@/lib/cover/variants";
import { coverGeometry } from "@/lib/kdp/geometry";
import type { Asset, CoverVariant, Project } from "@/lib/schema/project";
import { PageThumb } from "./PageThumb";

/** The other cover designs autopilot scored, each one click away. */
export function CoverVariants({ project, disabled, onUse }: { project: Project; disabled: boolean; onUse: (v: CoverVariant) => void }) {
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const previews = useMemo(() => {
    const words = coverWords(project);
    const geometry = coverGeometry(project.spec, project.interior.pages.length);
    const art = project.coverArt?.candidates.find((c) => c.id === project.coverArt?.chosenId);
    const artAsset: Asset | null = art
      ? { id: "variant-art", name: "preview", mime: "image/png", dataUrl: art.dataUrl, widthPx: art.widthPx, heightPx: art.heightPx, origin: "ai-generated", license: { license: "", author: "", source: "", commercialUse: true }, contentHash: "", createdAt: "" }
      : null;
    return (project.cover.variants ?? []).map((v) => {
      const withArt = isArtTemplate(v.templateId) && artAsset;
      const cover = buildCover(v.templateId, { ...words, backText: "", palette: variantPalette(v), ...(withArt ? { art: { assetId: artAsset.id } } : {}) }, geometry);
      return { v, cover, assets: withArt ? [artAsset] : [] };
    });
  }, [project]);
  const variants = project.cover.variants ?? [];
  if (variants.length < 2) return null;
  const isOn = (v: CoverVariant) => project.cover.templateId === v.templateId && (project.cover.palette?.id ?? project.cover.paletteId) === (v.palette?.id ?? v.paletteId);
  return (
    <>
      <strong style={{ fontSize: 13 }}>Other designs</strong>
      <div className="candidate-strip" role="list" aria-label="Other cover designs">
        {previews.map(({ v, cover, assets }) => {
          const on = isOn(v);
          const label = `${templateInfo(v.templateId)?.name ?? v.templateId}, ${variantPalette(v).name} palette (score ${Math.round(v.score)})`;
          return (
            <div key={`${v.templateId}|${v.paletteId}`} role="listitem" aria-label={label} className={`candidate${on ? " on" : ""}`} title={label}>
              <PageThumb elements={cover.elements} widthPt={cg.trimW} heightPt={cg.trimH} originX={-cg.front.x} originY={-cg.front.y} background={cover.background} assets={assets} px={84} alt={label} />
              <button className="btn btn-sm" disabled={on || disabled} onClick={() => onUse(v)}>
                {on ? "On cover" : "Use"}
              </button>
            </div>
          );
        })}
      </div>
      {variants[0]?.reason && <p className="field-hint" style={{ margin: 0 }}>Why this design: {variants[0].reason}</p>}
    </>
  );
}
