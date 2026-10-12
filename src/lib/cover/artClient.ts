"use client";

import { produce } from "immer";
import { callAi, isModelOutput, modelRun, type AiImage } from "@/lib/ai/client";
import type { CoverArtPromptOutput } from "@/lib/ai/tasks";
import { coverGeometry, interiorGeometry, type CoverGeometry } from "@/lib/kdp/geometry";
import { ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import type { Asset, CoverArtCandidate, Element, ModelRun, Project } from "@/lib/schema/project";
import { regionTone } from "@/lib/util/color";
import { newId, ptToIn, sha256Hex } from "@/lib/util/ids";
import { artBox, artStoreSize, coverCrop, CROP_OFFSETS, finalArtPrompt, isArtTemplate, type ArtTemplateId } from "./art";
import { coverBadge, coverMotif, coverSeed, NOT_CONTENT, seriesName, seriesVolume, whatsInside } from "./inside";
import { genreOfProject } from "./genres";
import { applyCoverTemplate, type SavedCoverTemplate } from "./library";
import { buildCover, PALETTES, type ArtTone, type CoverInput, type Palette } from "./templates";
import { analyzeCover } from "./analyze";
import { paletteFromPixels } from "./artPalette";

/**
 * Cover art in the browser: ask the server for images, keep the originals as
 * candidates, crop and upscale the chosen one to print resolution, measure
 * the art behind the title, and lay out the full cover. Used by the Cover tab
 * and by autopilot.
 */

export interface ImageStatus {
  provider: "openai" | "codex" | "none";
  model: string;
  configured: boolean;
  detail: string;
}

export async function imageStatus(): Promise<ImageStatus> {
  const res = await fetch("/api/image");
  return res.json();
}

interface GeneratedImage {
  data: string;
  mediaType: "image/png" | "image/jpeg";
  widthPx: number;
  heightPx: number;
  provider: string;
  model: string;
  promptHash: string;
}

async function generateImage(prompt: string, widthIn: number, heightIn: number, signal?: AbortSignal): Promise<GeneratedImage> {
  const res = await fetch("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, widthIn, heightIn }), signal });
  const body = await res.json().catch(() => ({ error: `Image request failed (${res.status})` }));
  if (!res.ok) throw new Error(body.error ?? `Image request failed (${res.status})`);
  return body as GeneratedImage;
}

/** Ask the text model for art concepts, a layout and a palette. */
export async function directArt(project: Project, count: number, signal?: AbortSignal, feedback?: string): Promise<{ direction: CoverArtPromptOutput; run: ModelRun | null }> {
  const m = project.metadata;
  const res = await callAi(
    "cover-art-prompt",
    {
      title: m.title || project.name,
      subtitle: m.subtitle,
      bookType: project.bookType,
      topic: project.brief.topic || m.title || project.name,
      audience: project.brief.audience || "adults",
      coverDirection: project.brief.coverDirection,
      count,
      ...(feedback?.trim() ? { feedback: feedback.trim() } : {}),
    },
    signal,
  );
  const direction = { ...res.output, concepts: res.output.concepts.filter((c) => c.prompt.trim()).slice(0, count) };
  return { direction, run: isModelOutput(res.meta) ? modelRun(res.meta, ["cover.art-direction"]) : null };
}

/**
 * Generate one image per concept for `layout`, in parallel. Failed images are
 * reported, not thrown, as long as at least one succeeds.
 */
export async function generateCandidates(
  concepts: { name: string; prompt: string }[],
  layout: ArtTemplateId,
  cg: CoverGeometry,
  signal?: AbortSignal,
  /** The genre's art style (cover/genres artStyle). */
  style?: string,
): Promise<{ candidates: CoverArtCandidate[]; runs: ModelRun[]; errors: string[] }> {
  const box = artBox(layout, cg);
  const settled = await Promise.allSettled(
    concepts.map(async (c) => {
      const prompt = finalArtPrompt(c.prompt, layout, style);
      const img = await generateImage(prompt, ptToIn(box.width), ptToIn(box.height), signal);
      const id = newId("art");
      const run: ModelRun = { id: newId("run"), at: new Date().toISOString(), provider: img.provider, model: img.model, task: "cover-art", promptHash: img.promptHash, outputs: [`cover.art:${id}`] };
      const candidate: CoverArtCandidate = {
        id,
        name: c.name,
        prompt,
        dataUrl: `data:${img.mediaType};base64,${img.data}`,
        widthPx: img.widthPx,
        heightPx: img.heightPx,
        provider: img.provider,
        model: img.model,
        runId: run.id,
        layout,
        createdAt: run.at,
      };
      return { candidate, run };
    }),
  );
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const errors = [...new Set(settled.flatMap((s) => (s.status === "rejected" ? [s.reason instanceof Error ? s.reason.message : String(s.reason)] : [])))];
  if (!ok.length) throw new Error(errors[0] ?? "No images were generated.");
  return { candidates: ok.map((o) => o.candidate), runs: ok.map((o) => o.run), errors };
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the generated image"));
    img.src = src;
  });
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [c, ctx];
}

/** Crop a candidate to the layout's art box and, when it's short of 300 DPI, upscale it in steps (smoother than one big jump). */
export async function artAsset(candidate: CoverArtCandidate, layout: ArtTemplateId, cg: CoverGeometry, upscale = true): Promise<Asset> {
  const img = await loadImg(candidate.dataUrl);
  const box = artBox(layout, cg);
  const crop = coverCrop(img.naturalWidth, img.naturalHeight, box.width / box.height, layout === "art-full-bleed" ? calmestOffset(img, box, cg) : 0.5);
  let [canvas, ctx] = canvasOf(crop.sw, crop.sh);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
  const target = upscale ? artStoreSize(box, crop.sw, crop.sh) : { width: crop.sw, height: crop.sh, upscaled: false };
  while (target.upscaled && canvas.width < target.width) {
    const w = Math.min(target.width, canvas.width * 2);
    const h = w === target.width ? target.height : Math.round((canvas.height * w) / canvas.width);
    const [next, nctx] = canvasOf(w, h);
    nctx.drawImage(canvas, 0, 0, w, h);
    [canvas, ctx] = [next, nctx];
  }
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    id: newId("asset"),
    name: `cover-art:${candidate.name}`,
    mime: "image/jpeg",
    dataUrl,
    widthPx: canvas.width,
    heightPx: canvas.height,
    origin: "ai-generated",
    license: {
      license: "AI-generated image (provider terms assign output rights to the user)",
      author: "",
      source: `${candidate.provider} ${candidate.model}, generated ${candidate.createdAt.slice(0, 10)}`,
      commercialUse: true,
      attribution: "",
    },
    contentHash: `sha256:${await sha256Hex(dataUrl)}`,
    createdAt: new Date().toISOString(),
    ...(target.upscaled ? { upscaledFrom: { widthPx: crop.sw, heightPx: crop.sh } } : {}),
  };
}

/**
 * For full-bleed art taller than the cover: how far down to crop so the
 * title zone (the top third of the front) lands on the calmest part of the
 * image. Images that already fit are centered.
 */
function calmestOffset(img: HTMLImageElement, box: { x: number; y: number; width: number; height: number }, cg: CoverGeometry): number {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const aspect = box.width / box.height;
  if (w / h >= aspect) return 0.5;
  const [c, ctx] = canvasOf(96, Math.max(1, Math.round((96 * h) / w)));
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const k = c.width / w;
  let best = { offset: 0.5, spread: Infinity };
  for (const offset of CROP_OFFSETS) {
    const crop = coverCrop(w, h, aspect, offset);
    const y0 = Math.round((crop.sy + ((cg.frontSafe.y - box.y) / box.height) * crop.sh) * k);
    const y1 = Math.round((crop.sy + ((cg.frontSafe.y + cg.trimH * 0.34 - box.y) / box.height) * crop.sh) * k);
    const tone = regionTone(ctx.getImageData(0, Math.max(0, y0), c.width, Math.max(1, y1 - y0)).data);
    // Ties go to the centered crop.
    if (tone.spread < best.spread - 0.005 || (Math.abs(tone.spread - best.spread) <= 0.005 && Math.abs(offset - 0.5) < Math.abs(best.offset - 0.5))) best = { offset, spread: tone.spread };
  }
  return best.offset;
}

/** A palette drawn from an image's own colors (see cover/artPalette). */
export async function paletteFromArt(dataUrl: string): Promise<Palette | null> {
  const img = await loadImg(dataUrl);
  const [c, ctx] = canvasOf(64, Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth)));
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return paletteFromPixels(ctx.getImageData(0, 0, c.width, c.height).data);
}

/** Tone of the art under the full-bleed title plate (the top third of the front). */
export async function measureTone(asset: Asset, cg: CoverGeometry): Promise<ArtTone> {
  const img = await loadImg(asset.dataUrl);
  const box = artBox("art-full-bleed", cg);
  const [c, ctx] = canvasOf(96, Math.max(1, Math.round((96 * img.naturalHeight) / img.naturalWidth)));
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const y0 = Math.round(((cg.frontSafe.y - box.y) / box.height) * c.height);
  const y1 = Math.round(((cg.frontSafe.y + cg.trimH * 0.34 - box.y) / box.height) * c.height);
  return regionTone(ctx.getImageData(0, y0, c.width, Math.max(1, y1 - y0)).data);
}

/** Pages worth showing on the back: the first page of up to three body sections. */
export function thumbnailPages(project: Project, max = 3): number[] {
  const pages = project.interior.pages;
  const content = (i: number) => i >= 0 && !NOT_CONTENT.has(pages[i].generator?.kind ?? "blank") && pages[i].elements.length > 0;
  const out: number[] = [];
  for (const s of project.interior.sections) {
    if (out.length >= max) break;
    if (s.role !== "body") continue;
    const i = pages.findIndex((p) => p.sectionId === s.id);
    if (content(i)) out.push(i);
  }
  // Too few sections (a hand-built book): take distinct page types in book order.
  const seen = new Set(out.map((i) => pages[i].generator?.kind));
  for (let i = 0; i < pages.length && out.length < max; i++) {
    const kind = pages[i].generator?.kind;
    if (content(i) && !seen.has(kind)) {
      seen.add(kind);
      out.push(i);
    }
  }
  return out.sort((a, b) => a - b);
}

async function pageThumbnails(project: Project): Promise<Asset[]> {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const g = interiorGeometry(project.spec, project.interior.pages.length);
  return Promise.all(
    thumbnailPages(project).map(async (index) => {
      const canvas = rasterize({ widthPt: g.trimW, heightPt: g.trimH, scale: 480 / g.trimW, background: "#ffffff", elements: project.interior.pages[index].elements, images });
      const dataUrl = canvas.toDataURL("image/png");
      return {
        id: newId("asset"),
        name: `cover-thumb:page ${index + 1}`,
        mime: "image/png" as const,
        dataUrl,
        widthPx: canvas.width,
        heightPx: canvas.height,
        origin: "generated" as const,
        license: { license: "Rendered from this book's interior", author: "", source: `Interior page ${index + 1}`, commercialUse: true, attribution: "" },
        contentHash: `sha256:${await sha256Hex(dataUrl)}`,
        createdAt: new Date().toISOString(),
      };
    }),
  );
}

/** Assets the cover builder owns; they're replaced on every rebuild. */
const coverOwned = (a: Asset) => a.name.startsWith("cover-art:") || a.name.startsWith("cover-thumb:") || a.name.startsWith("cover-template:");

export interface CoverDesign {
  templateId: string;
  palette: Palette;
  backText: string;
  /** Candidate to use with an art template (defaults to the chosen one). */
  candidateId?: string;
  inside: boolean;
  thumbs: boolean;
  /** Mark subtitle and blurb as AI text from this listing run. */
  listingRunId?: string;
  aiListing?: boolean;
  /** Badge text; "" hides the badge, unset keeps the cover's own or the default. */
  badge?: string;
  /** Lay out this saved template instead of `templateId`. */
  saved?: SavedCoverTemplate;
  /** Notes about the result, e.g. a saved template stretched to a new trim size. */
  onWarnings?: (warnings: string[]) => void;
}

/** The book's own words and type for its cover: everything a template needs except the palette, art and back-cover extras. */
export function coverWords(project: Project, badge?: string): Omit<CoverInput, "palette" | "backText"> {
  const m = project.metadata;
  return {
    title: m.title || project.name,
    subtitle: m.subtitle,
    author: m.author,
    badge: badge ?? project.cover.badge ?? coverBadge(project),
    series: seriesName(m.series),
    volume: seriesVolume(m.series),
    type: genreOfProject(project).type,
    ...(project.brief.titleHero ? { titleHero: project.brief.titleHero } : {}),
    motif: coverMotif(project),
    seed: coverSeed(project),
  };
}

/** Lay out the whole cover from a design choice, replacing the cover's own assets. */
export async function designCover(project: Project, d: CoverDesign): Promise<Project> {
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const art = project.coverArt;
  const candidate = art?.candidates.find((c) => c.id === (d.candidateId ?? art.chosenId));
  const added: Asset[] = [];
  let artInput: { assetId: string; runId?: string; tone?: ArtTone } | undefined;
  if (isArtTemplate(d.templateId) && candidate) {
    const asset = await artAsset(candidate, d.templateId, cg);
    added.push(asset);
    artInput = { assetId: asset.id, runId: candidate.runId, tone: d.templateId === "art-full-bleed" ? await measureTone(asset, cg) : undefined };
  }
  const thumbs = d.thumbs ? await pageThumbnails(project) : [];
  added.push(...thumbs);
  const input: CoverInput = {
    ...coverWords(project, d.badge),
    backText: d.backText,
    palette: d.palette,
    art: artInput,
    inside: d.inside ? whatsInside(project) : [],
    thumbs: thumbs.map((t) => t.id),
  };
  let cover: { background: string; elements: Element[]; templateId?: string; barcode?: Project["cover"]["barcode"] };
  if (d.saved) {
    const applied = applyCoverTemplate(d.saved, input, cg);
    // An image the book already keeps for itself (a logo also used inside) stays as it is.
    const own = new Set(project.assets.filter((a) => !coverOwned(a)).map((a) => a.id));
    added.push(...applied.assets.filter((a) => !own.has(a.id)).map((a) => ({ ...a, name: a.name.startsWith("cover-template:") ? a.name : `cover-template:${a.name}` })));
    cover = applied.cover;
    d.onWarnings?.(applied.warnings);
  } else cover = buildCover(d.templateId, input, cg);
  const used = new Set(cover.elements.flatMap((e) => (e.type === "image" ? [e.assetId] : [])));
  const assets = [...project.assets.filter((a) => !coverOwned(a)), ...added.filter((a) => used.has(a.id))];
  const elements = cover.elements.map((el) =>
    (d.aiListing || d.listingRunId) && el.type === "text" && (el.name === "Back hook" || el.name === "Back blurb" || el.name === "Subtitle")
      ? { ...el, provenance: { origin: "ai-generated" as const, ...(d.listingRunId ? { runId: d.listingRunId } : {}) } }
      : el,
  ) as Element[];
  const analysis = await analyzeCover({ background: cover.background, elements }, cg, assets, { clutterOk: genreOfProject(project).clutterOk });
  return produce(project, (draft) => {
    draft.assets = assets;
    draft.cover.background = cover.background;
    draft.cover.templateId = cover.templateId;
    if (d.saved) {
      delete draft.cover.paletteId;
      delete draft.cover.palette;
      if (cover.barcode) draft.cover.barcode = cover.barcode;
    } else {
      draft.cover.paletteId = d.palette.id;
      // A palette that isn't built in (taken from the art) is kept with the cover so a rebuild can reuse it.
      if (PALETTES.some((p) => p.id === d.palette.id)) delete draft.cover.palette;
      else draft.cover.palette = { ...d.palette };
    }
    if (d.badge !== undefined) draft.cover.badge = d.badge;
    draft.cover.elements = elements;
    draft.cover.analysis = analysis;
    if (draft.coverArt && artInput && candidate) draft.coverArt.chosenId = candidate.id;
  });
}

const jpeg = (c: HTMLCanvasElement) => c.toDataURL("image/jpeg", 0.85).split(",")[1];

/**
 * Pick the best candidate. Each is typeset as a front cover; a vision model
 * chooses when one is available, otherwise the calmest art behind the title
 * wins (for layouts where the title sits on the art).
 */
export async function pickCandidate(
  project: Project,
  candidates: CoverArtCandidate[],
  layout: ArtTemplateId,
  palette: Palette,
  signal?: AbortSignal,
): Promise<{ index: number; reason: string; run: ModelRun | null; textInArt: number[] }> {
  if (candidates.length === 1) return { index: 0, reason: "Only one candidate", run: null, textInArt: [] };
  await ensureFonts();
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const m = project.metadata;
  const previews: AiImage[] = [];
  const spreads: number[] = [];
  for (const [i, c] of candidates.entries()) {
    const asset = await artAsset(c, layout, cg, false);
    const tone = layout === "art-full-bleed" ? await measureTone(asset, cg) : undefined;
    spreads.push(tone?.spread ?? 0);
    const cover = buildCover(layout, { ...coverWords(project), backText: "", palette, art: { assetId: asset.id, tone } }, cg);
    const images = await loadImages([asset]);
    const canvas = rasterize({ widthPt: cg.front.width, heightPt: cg.front.height, scale: 720 / cg.front.height, background: cover.background, elements: cover.elements, images, originX: -cg.front.x, originY: -cg.front.y });
    previews.push({ label: `Candidate ${i + 1}: ${c.name}`, mediaType: "image/jpeg", data: jpeg(canvas) });
  }
  const calmest = spreads.indexOf(Math.min(...spreads));
  const fallback = { index: calmest, reason: layout === "art-full-bleed" ? "Calmest art behind the title (measured)" : "First candidate", run: null, textInArt: [] as number[] };
  try {
    const res = await callAi("cover-art-pick", { title: m.title || project.name, bookType: project.bookType, audience: project.brief.audience || "adults", images: previews.map((p) => p.label) }, signal, previews);
    if (!isModelOutput(res.meta)) return fallback;
    // Art with lettering in it (garbled text is common in generated images) is never put on the cover when there's another choice.
    const textInArt = [...new Set((res.output.textInArt ?? []).map((n) => n - 1).filter((i) => i >= 0 && i < candidates.length))];
    let index = res.output.choice - 1;
    if (index < 0 || index >= candidates.length) return { ...fallback, textInArt };
    let note = "";
    if (textInArt.includes(index)) {
      const clean = candidates.findIndex((_, i) => !textInArt.includes(i));
      if (clean >= 0) {
        index = clean;
        note = " The first choice had lettering in the art, so the best one without any was used.";
      }
    }
    const problems = res.output.problems.length ? ` Watch for: ${res.output.problems.join("; ")}` : "";
    return { index, reason: `${res.output.reason}${problems}${note}`, run: modelRun(res.meta, ["cover.art-pick"]), textInArt };
  } catch (e) {
    if (signal?.aborted) throw e;
    return fallback;
  }
}
