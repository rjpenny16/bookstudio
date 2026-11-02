"use client";

import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import { EBOOK_COVER_PX, EBOOK_IMAGE_PRESETS, EBOOK_JPEG_QUALITY, type EbookImagePreset } from "@/lib/kdp/rules-ebook";
import { canvasToBlob, ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import { buildFixedLayoutEpub, languageCode, type EpubImage } from "@/lib/render/epub";
import { pageNumberElement } from "@/lib/render/pageNumbers";
import type { Project } from "@/lib/schema/project";

export interface BuiltEbook {
  epub: Uint8Array;
  cover: Blob;
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

/** Render every interior page (trim size, no bleed, page numbers included) and pack a fixed-layout EPUB. */
export async function buildEbook(project: Project, preset: EbookImagePreset = "standard", onProgress?: (label: string, f: number) => void): Promise<BuiltEbook> {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const n = project.interior.pages.length;
  const g = interiorGeometry(project.spec, n);
  const scale = EBOOK_IMAGE_PRESETS[preset] / Math.max(g.trimW, g.trimH);
  const pn = project.interior.pageNumbers;
  const pages: EpubImage[] = [];
  for (let i = 0; i < n; i++) {
    const page = project.interior.pages[i];
    const elements = pn.enabled && i + 1 >= pn.startAt && !page.hideNumber ? [...page.elements, pageNumberElement(project, i)] : page.elements;
    pages.push(await toImage(rasterize({ widthPt: g.trimW, heightPt: g.trimH, scale, background: "#ffffff", elements, images })));
    if (i % 5 === 4) onProgress?.("Rendering eBook pages", (i + 1) / n);
  }
  onProgress?.("Rendering eBook cover", 0.95);
  const coverCanvas = await renderEbookCover(project, images);
  const cover = await canvasToBlob(coverCanvas, "image/jpeg", 0.9);
  const coverImage: EpubImage = { bytes: new Uint8Array(await cover.arrayBuffer()), mime: "image/jpeg", width: coverCanvas.width, height: coverCanvas.height };
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
  return { epub, cover, pages: n, pageWidth: pages[0]?.width ?? 0, pageHeight: pages[0]?.height ?? 0 };
}

/** The interior with no bleed, for Kindle Create's PDF import if KDP turns down the EPUB. */
export const kindleCreateProject = (p: Project): Project => ({ ...p, spec: { ...p.spec, bleed: false } });
