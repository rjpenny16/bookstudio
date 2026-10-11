/**
 * Browser half of the sample harness. Bundled with esbuild and injected into
 * an app page (so the bundled fonts are already declared), it draws a book's
 * cover and chosen spreads with the same canvas renderer the app uses for
 * previews, and hands back PNG data URLs.
 */
import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import { ensureFonts, loadImages, rasterize } from "@/lib/render/canvas";
import { pageNumberElement } from "@/lib/render/pageNumbers";
import type { Project } from "@/lib/schema/project";

export interface Spread {
  /** Left (even-numbered) page index, or null for a lone first page. */
  verso: number | null;
  /** Right (odd-numbered) page index, or null past the last page. */
  recto: number | null;
  label: string;
}

export interface SampleImages {
  coverWrap: string;
  coverFront: string;
  coverThumb: string;
  spreads: string;
}

const PAGE_PX = 340;
const GAP = 28;
const LABEL_H = 26;
const SHEET_COLS = 2;

function pageElements(project: Project, i: number) {
  const page = project.interior.pages[i];
  const pn = project.interior.pageNumbers;
  return pn.enabled && i + 1 >= pn.startAt && !page.hideNumber ? [...page.elements, pageNumberElement(project, i)] : page.elements;
}

async function render(project: Project, spreads: Spread[]): Promise<SampleImages> {
  await ensureFonts();
  const images = await loadImages(project.assets);
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const cover = (widthPx: number, box?: { x: number; y: number; width: number; height: number }) =>
    rasterize({
      widthPt: box?.width ?? cg.width,
      heightPt: box?.height ?? cg.height,
      scale: widthPx / (box?.width ?? cg.width),
      background: project.cover.background,
      elements: project.cover.elements,
      images,
      originX: box ? -box.x : 0,
      originY: box ? -box.y : 0,
    });
  const coverWrap = cover(1600).toDataURL("image/png");
  const coverFront = cover(800, cg.front).toDataURL("image/png");
  // Amazon search results show covers about 160 px tall.
  const coverThumb = cover(Math.round((160 * cg.front.width) / cg.front.height), cg.front).toDataURL("image/png");

  const g = interiorGeometry(project.spec, project.interior.pages.length);
  const pageH = Math.round((PAGE_PX * g.trimH) / g.trimW);
  const spreadW = PAGE_PX * 2;
  const rows = Math.ceil(spreads.length / SHEET_COLS);
  const sheet = document.createElement("canvas");
  sheet.width = SHEET_COLS * spreadW + (SHEET_COLS + 1) * GAP;
  sheet.height = rows * (pageH + LABEL_H) + (rows + 1) * GAP;
  const ctx = sheet.getContext("2d")!;
  ctx.fillStyle = "#d9d6cf";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  spreads.forEach((s, n) => {
    const x0 = GAP + (n % SHEET_COLS) * (spreadW + GAP);
    const y0 = GAP + Math.floor(n / SHEET_COLS) * (pageH + LABEL_H + GAP);
    [s.verso, s.recto].forEach((index, side) => {
      if (index === null) return;
      const c = rasterize({ widthPt: g.trimW, heightPt: g.trimH, scale: PAGE_PX / g.trimW, background: "#ffffff", elements: pageElements(project, index), images });
      ctx.drawImage(c, x0 + side * PAGE_PX, y0);
    });
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.moveTo(x0 + PAGE_PX + 0.5, y0);
    ctx.lineTo(x0 + PAGE_PX + 0.5, y0 + pageH);
    ctx.stroke();
    ctx.fillStyle = "#222";
    ctx.font = '600 14px "UI Sans", sans-serif';
    ctx.fillText(s.label, x0, y0 + pageH + 18);
  });
  return { coverWrap, coverFront, coverThumb, spreads: sheet.toDataURL("image/png") };
}

(window as unknown as { __renderSample: typeof render }).__renderSample = render;
