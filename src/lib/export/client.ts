"use client";

import { coverGeometry } from "@/lib/kdp/geometry";
import { canvasToBlob, ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import { browserFontLoader } from "@/lib/render/fonts";
import { renderMockup } from "@/lib/render/mockup";
import type { Project } from "@/lib/schema/project";
import { editionOf } from "@/lib/schema/formats";
import { hardcoverProject } from "@/lib/schema/hardcover";
import { buildEbook } from "./ebook";
import { ebookLayoutOf } from "./ebookBlocks";
import { buildKdpPackage, downloadBlob, printFormats, slug } from "./package";

/** Full cover, front panel and a paperback mockup, rendered in the browser. */
export async function coverImages(project: Project) {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const scale = 1600 / cg.front.width / 1.5;
  const full = rasterize({ widthPt: cg.width, heightPt: cg.height, scale, background: project.cover.background, elements: project.cover.elements, images });
  const crop = (b: { x: number; y: number; width: number; height: number }) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(b.width * scale));
    c.height = Math.round(b.height * scale);
    c.getContext("2d")!.drawImage(full, Math.round(b.x * scale), Math.round(b.y * scale), c.width, c.height, 0, 0, c.width, c.height);
    return c;
  };
  const front = crop(cg.front);
  const spine = cg.spine > 2 ? crop(cg.spineBox) : null;
  return { full, front, mockup: renderMockup(front, spine) };
}

/** Build the KDP package zip and download it. `draft` marks a package that still has blocking preflight issues. */
export async function downloadPackage(project: Project, draft: boolean, onProgress: (label: string, f: number) => void): Promise<void> {
  const { full, mockup } = await coverImages(project);
  const hardcover = printFormats(project).includes("hardcover") ? (await coverImages(hardcoverProject(project))).mockup : null;
  const ed = editionOf(project, "ebook");
  const ebook = ed.enabled ? await buildEbook(project, ed.ebookImage ?? "standard", (label, f) => onProgress(label, f * 0.5), ebookLayoutOf(project)) : null;
  const blob = await buildKdpPackage(project, {
    ebook: ebook ? { epub: ebook.epub, coverJpg: ebook.cover } : undefined,
    loadFont: browserFontLoader,
    coverPreviewPng: await canvasToBlob(full),
    mockupPng: await canvasToBlob(mockup),
    hardcoverMockupPng: hardcover ? await canvasToBlob(hardcover) : undefined,
    onProgress,
  });
  downloadBlob(blob, `${slug(project.metadata.title || project.name)}-kdp${draft ? "-draft" : ""}.zip`);
}
