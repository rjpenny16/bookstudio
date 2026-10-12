"use client";

import { callAi, isModelOutput, modelRun, type AiImage } from "@/lib/ai/client";
import { coverGeometry, type CoverGeometry } from "@/lib/kdp/geometry";
import { THUMBNAIL_PX } from "@/lib/quality/design";
import { ensureFonts, loadImages, rasterize, type ImageCache } from "@/lib/render/canvas";
import type { Asset, CoverAnalysis, CoverVariant, ModelRun, Project } from "@/lib/schema/project";
import { analyzeCover } from "./analyze";
import { ART_TEMPLATES, isArtTemplate } from "./art";
import { artAsset, coverWords, measureTone } from "./artClient";
import { genreOfProject, type GenreProfile } from "./genres";
import { buildCover, PALETTES, type Palette } from "./templates";

/**
 * Cover variant search: lay out the book's title in several of its genre's
 * templates and palettes, score each one on its rendered pixels, and let a
 * vision model choose among the best (offline, the best score wins). Only the
 * front is compared; the chosen design is then built in full by designCover.
 */

export interface VariantSpec {
  templateId: string;
  palette: Palette;
}

export interface ScoredVariant extends VariantSpec {
  analysis: CoverAnalysis;
  /** Out of 100: 90% the pixel score, 10% genre fit. What variants are ranked by. */
  score: number;
}

const MAX_VARIANTS = 6;
const SHORTLIST = 3;

const paletteById = (id: string) => PALETTES.find((p) => p.id === id);

/**
 * Template and palette combinations to try, best guesses first: the starting
 * design, then the genre's best templates and palettes, nearest combinations
 * first. Art covers vary the art layout instead of the vector template.
 */
export function variantSpecs(project: Project, base: VariantSpec, extraPalettes: Palette[] = [], max = MAX_VARIANTS): VariantSpec[] {
  const genre = genreOfProject(project);
  const art = isArtTemplate(base.templateId);
  const templates = [...new Set([base.templateId, ...(art ? ART_TEMPLATES : genre.templates.slice(0, 3))])];
  const palettes: Palette[] = [];
  for (const p of [base.palette, ...extraPalettes, ...genre.palettes.slice(0, 2).map(paletteById)]) if (p && !palettes.some((x) => x.id === p.id)) palettes.push(p);
  const combos = templates.flatMap((t, i) => palettes.map((p, j) => ({ spec: { templateId: t, palette: p }, rank: i + j + (i && j ? 0.5 : 0) })));
  return combos
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
    .map((c) => c.spec);
}

/** Lay out and score each variant's front cover. */
export async function scoreVariants(project: Project, specs: VariantSpec[]): Promise<ScoredVariant[]> {
  await ensureFonts();
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const words = coverWords(project);
  const genre = genreOfProject(project);
  const art = project.coverArt?.candidates.find((c) => c.id === project.coverArt?.chosenId);
  const artByLayout = new Map<string, { asset: Asset; tone?: { mean: string; spread: number } }>();
  const cache: ImageCache = new Map();
  const out: ScoredVariant[] = [];
  for (const spec of specs) {
    let artInput: { assetId: string; tone?: { mean: string; spread: number } } | undefined;
    const assets: Asset[] = [];
    if (isArtTemplate(spec.templateId) && art) {
      let a = artByLayout.get(spec.templateId);
      if (!a) {
        // Scoring doesn't need print resolution, so the art isn't upscaled here.
        const asset = await artAsset(art, spec.templateId, cg, false);
        a = { asset, tone: spec.templateId === "art-full-bleed" ? await measureTone(asset, cg) : undefined };
        artByLayout.set(spec.templateId, a);
      }
      artInput = { assetId: a.asset.id, tone: a.tone };
      assets.push(a.asset);
    } else if (isArtTemplate(spec.templateId)) continue;
    const cover = buildCover(spec.templateId, { ...words, backText: "", palette: spec.palette, art: artInput }, cg);
    const analysis = await analyzeCover(cover, cg, assets, { clutterOk: genre.clutterOk, cache });
    // 90% how it reads, 10% how well it fits the genre: out of 100.
    out.push({ ...spec, analysis, score: Math.round((analysis.score * 0.9 + genreFit(genre, spec)) * 10) / 10 });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Up to 10 points for following the genre's conventions, so a design shoppers
 * expect in the niche beats an equally legible one that looks off-genre.
 */
export function genreFit(genre: GenreProfile, spec: VariantSpec): number {
  const t = genre.templates.indexOf(spec.templateId);
  const p = genre.palettes.indexOf(spec.palette.id);
  return ([8, 5, 3][t] ?? (isArtTemplate(spec.templateId) ? 5 : 1)) + ([2, 1][p] ?? 0);
}

async function frontImages(project: Project, v: VariantSpec, cg: CoverGeometry, n: number): Promise<AiImage[]> {
  const art = project.coverArt?.candidates.find((c) => c.id === project.coverArt?.chosenId);
  const assets: Asset[] = [];
  let artInput: { assetId: string } | undefined;
  if (isArtTemplate(v.templateId) && art) {
    const asset = await artAsset(art, v.templateId, cg, false);
    assets.push(asset);
    artInput = { assetId: asset.id };
  }
  const cover = buildCover(v.templateId, { ...coverWords(project), backText: "", palette: v.palette, art: artInput }, cg);
  const images = await loadImages(assets);
  const draw = (px: number) =>
    rasterize({ widthPt: cg.front.width, heightPt: cg.front.height, scale: px / cg.front.height, background: cover.background, elements: cover.elements, images, originX: -cg.front.x, originY: -cg.front.y })
      .toDataURL("image/jpeg", 0.85)
      .split(",")[1];
  return [
    { label: `Design ${n}, full size`, mediaType: "image/jpeg", data: draw(600) },
    { label: `Design ${n}, as a ${THUMBNAIL_PX} px search thumbnail`, mediaType: "image/jpeg", data: draw(THUMBNAIL_PX) },
  ];
}

export interface VariantChoice {
  winner: ScoredVariant;
  /** All scored variants, best first. */
  ranked: ScoredVariant[];
  reason: string;
  run: ModelRun | null;
}

/** Score the variants, then let a vision model pick from the best few (the top score wins without one). */
export async function chooseVariant(project: Project, base: VariantSpec, extraPalettes: Palette[] = [], signal?: AbortSignal): Promise<VariantChoice> {
  const ranked = await scoreVariants(project, variantSpecs(project, base, extraPalettes));
  if (!ranked.length) throw new Error("No cover design could be laid out.");
  const best = ranked[0];
  const fallback: VariantChoice = { winner: best, ranked, reason: `Best measured design: ${best.analysis.score}/100 on contrast, title size, clutter and balance, plus genre fit`, run: null };
  const shortlist = ranked.slice(0, SHORTLIST);
  if (shortlist.length < 2) return fallback;
  try {
    const cg = coverGeometry(project.spec, project.interior.pages.length);
    const images = (await Promise.all(shortlist.map((v, i) => frontImages(project, v, cg, i + 1)))).flat();
    const res = await callAi(
      "cover-variant-pick",
      { title: project.metadata.title || project.name, bookType: project.bookType, audience: project.brief.audience || "adults", genre: genreOfProject(project).label, images: images.map((i) => i.label) },
      signal,
      images,
    );
    if (!isModelOutput(res.meta)) return fallback;
    const pick = shortlist[res.output.choice - 1];
    if (!pick) return fallback;
    const problems = res.output.problems.length ? ` Watch for: ${res.output.problems.join("; ")}` : "";
    return { winner: pick, ranked, reason: `${res.output.reason}${problems}`, run: modelRun(res.meta, ["cover.variant-pick"]) };
  } catch (e) {
    if (signal?.aborted) throw e;
    return fallback;
  }
}

/** What's kept on the project: every scored variant, best first, with the winner's reason. */
export function storedVariants(choice: VariantChoice): CoverVariant[] {
  const order = [choice.winner, ...choice.ranked.filter((v) => v !== choice.winner)];
  return order.map((v) => ({
    templateId: v.templateId,
    paletteId: v.palette.id,
    ...(paletteById(v.palette.id) ? {} : { palette: { ...v.palette } }),
    score: v.score,
    ...(v === choice.winner ? { reason: choice.reason } : {}),
  }));
}

/** The palette a stored variant uses. */
export const variantPalette = (v: CoverVariant): Palette => v.palette ?? paletteById(v.paletteId) ?? PALETTES[0];

/**
 * The design to try when the visual review says the cover doesn't work: the
 * best scored variant in a different template, else the same template in the
 * genre's next palette.
 */
export function redesignTarget(project: Project): VariantSpec | null {
  const current = project.cover.templateId;
  const alt = (project.cover.variants ?? []).find((v) => v.templateId !== current);
  if (alt) return { templateId: alt.templateId, palette: variantPalette(alt) };
  if (!current) return null;
  const palettes = genreOfProject(project).palettes;
  const now = project.cover.palette?.id ?? project.cover.paletteId;
  const next = palettes.find((id) => id !== now && paletteById(id));
  return next ? { templateId: current, palette: paletteById(next)! } : null;
}
