"use client";

import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import { EBOOK_COVER_PX, EBOOK_IMAGE_PRESETS, EBOOK_JPEG_QUALITY, type EbookImagePreset } from "@/lib/kdp/rules-ebook";
import { canvasToBlob, ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import { buildFixedLayoutEpub, languageCode, type EpubImage } from "@/lib/render/epub";
import { buildTextEpub } from "@/lib/render/epubText";
import { pageNumberElement } from "@/lib/render/pageNumbers";
import { sectionsToBlocks } from "./ebookBlocks";
import type { Project } from "@/lib/schema/project";

export interface BuiltEbook {
  epub: Uint8Array;
  cover: Blob;
  layout: "fixed" | "text";
  /** Sections left out of a text eBook (writing space, the printed contents). */
  omitted: string[];
  pages: number;
  /** Page image size, pixels. */
  pageWidth: number;
  pageHeight: number;
}

const toImage = async (canvas: HTMLCanvasElement): Promise<EpubImage> => {
  const blob = await canvasToBlob(canvas, "image/jpeg", EBOOK_JPEG_QUALITY);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg", width: canvas.width, height: canvas.height };
};

/**
 * The Kindle cover: the front of the paperback cover on a 1600 x 2560 image. The front is
 * fitted inside it (a 6 x 9 front is a little wider than 1 : 1.6) and centered on the
 * cover's background, so nothing on the front is cropped.
 */
export async function renderEbookCover(project: Project, images: Awaited<ReturnType<typeof loadImages>>): Promise<HTMLCanvasElement> {
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const { width: W, height: H } = EBOOK_COVER_PX;
  const s = Math.min(W / cg.front.width, H / cg.front.height);
  const front = rasterize({ widthPt: cg.front.width, heightPt: cg.front.height, scale: s, background: project.cover.background, elements: project.cover.elements, images, originX: -cg.front.x, originY: -cg.front.y });
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = project.cover.background;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(front, Math.round((W - front.width) / 2), Math.round((H - front.height) / 2));
  return out;
}

/** Render interior pages (trim size, no bleed) as eBook images. Page numbers are drawn only on fixed-layout pages. */
async function renderPages(project: Project, indices: number[], preset: EbookImagePreset, withNumbers: boolean, images: Awaited<ReturnType<typeof loadImages>>, onProgress?: (label: string, f: number) => void): Promise<Map<number, EpubImage>> {
  const g = interiorGeometry(project.spec, project.interior.pages.length);
  const scale = EBOOK_IMAGE_PRESETS[preset] / Math.max(g.trimW, g.trimH);
  const pn = project.interior.pageNumbers;
  const out = new Map<number, EpubImage>();
  for (const [k, i] of indices.entries()) {
    const page = project.interior.pages[i];
    const elements = withNumbers && pn.enabled && i + 1 >= pn.startAt && !page.hideNumber ? [...page.elements, pageNumberElement(project, i)] : page.elements;
    out.set(i, await toImage(rasterize({ widthPt: g.trimW, heightPt: g.trimH, scale, background: "#ffffff", elements, images })));
    if (k % 5 === 4) onProgress?.("Rendering eBook pages", (k + 1) / indices.length);
  }
  return out;
}

/**
 * Build the Kindle eBook. "fixed": every interior page as an image in a fixed-layout EPUB.
 * "text": prose as reflowable text, puzzles and other pages that can't reflow as images,
 * writing space left out.
 */
export async function buildEbook(project: Project, preset: EbookImagePreset = "standard", onProgress?: (label: string, f: number) => void, layout: "fixed" | "text" = "fixed"): Promise<BuiltEbook> {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const n = project.interior.pages.length;
  if (layout === "text") return buildTextEbook(project, preset, images, onProgress);
  const rendered = await renderPages(project, project.interior.pages.map((_, i) => i), preset, true, images, onProgress);
  const pages = project.interior.pages.map((_, i) => rendered.get(i)!);
  onProgress?.("Rendering eBook cover", 0.95);
  const { blob: cover, image: coverImage } = await ebookCover(project, images);
  // Contents: each section's first page.
  const firstPage = new Map<string, number>();
  project.interior.pages.forEach((p, i) => p.sectionId && !firstPage.has(p.sectionId) && firstPage.set(p.sectionId, i));
  const toc = project.interior.sections.filter((s) => firstPage.has(s.id)).map((s) => ({ label: s.label, pageIndex: firstPage.get(s.id)! }));
  onProgress?.("Packing EPUB", 0.98);
  const epub = await buildFixedLayoutEpub({
    title: project.metadata.title || project.name,
    author: project.metadata.author,
    language: languageCode(project.metadata.language),
    cover: coverImage,
    pages,
    toc,
  });
  onProgress?.("Done", 1);
  return { epub, cover, layout: "fixed", omitted: [], pages: n, pageWidth: pages[0]?.width ?? 0, pageHeight: pages[0]?.height ?? 0 };
}

async function ebookCover(project: Project, images: Awaited<ReturnType<typeof loadImages>>) {
  const canvas = await renderEbookCover(project, images);
  const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  return { blob, image: { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg", width: canvas.width, height: canvas.height } as EpubImage };
}

async function buildTextEbook(project: Project, preset: EbookImagePreset, images: Awaited<ReturnType<typeof loadImages>>, onProgress?: (label: string, f: number) => void): Promise<BuiltEbook> {
  const plan = sectionsToBlocks(project);
  const indices = plan.blocks.flatMap((b) => (b.type === "images" ? b.pageIndices : []));
  const rendered = await renderPages(project, indices, preset, false, images, onProgress);
  onProgress?.("Rendering eBook cover", 0.95);
  const cover = await ebookCover(project, images);
  onProgress?.("Packing EPUB", 0.98);
  const epub = await buildTextEpub({ title: project.metadata.title || project.name, author: project.metadata.author, language: languageCode(project.metadata.language), cover: cover.image, blocks: plan.blocks, images: rendered });
  onProgress?.("Done", 1);
  const first = rendered.values().next().value as EpubImage | undefined;
  return { epub, cover: cover.blob, layout: "text", omitted: plan.omitted, pages: project.interior.pages.length, pageWidth: first?.width ?? 0, pageHeight: first?.height ?? 0 };
}

/** The interior with no bleed, for Kindle Create's PDF import if KDP turns down the EPUB. */
export const kindleCreateProject = (p: Project): Project => ({ ...p, spec: { ...p.spec, bleed: false } });
