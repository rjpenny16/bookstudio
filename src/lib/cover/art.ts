import type { Box, CoverGeometry } from "@/lib/kdp/geometry";
import { MIN_IMAGE_DPI } from "@/lib/kdp/rules";
import { ptToIn } from "@/lib/util/ids";

/**
 * Cover art helpers shared by the browser, the server route and the tests:
 * where each art template puts its image, what pixel size to ask the image
 * model for, how to crop a generated image to that box, and the fixed rules
 * every art prompt carries.
 */

export const ART_TEMPLATES = ["art-full-bleed", "art-panel", "art-framed"] as const;
export type ArtTemplateId = (typeof ART_TEMPLATES)[number];

export const isArtTemplate = (id: string | undefined): id is ArtTemplateId => (ART_TEMPLATES as readonly string[]).includes(id ?? "");

/** Front-cover box the art fills, in cover coordinates. Full-bleed and panel art run into the bleed. */
export function artBox(templateId: ArtTemplateId, cg: CoverGeometry): Box {
  const right = cg.width;
  const frontX = cg.front.x;
  switch (templateId) {
    case "art-full-bleed":
      return { x: frontX, y: 0, width: right - frontX, height: cg.height };
    case "art-panel": {
      const top = cg.front.y + cg.trimH * 0.4;
      return { x: frontX, y: top, width: right - frontX, height: cg.height - top };
    }
    case "art-framed": {
      const f = cg.frontSafe;
      const w = f.width - 56;
      const h = Math.min(w * 1.05, f.height * 0.5);
      return { x: f.x + (f.width - w) / 2, y: f.y + f.height * 0.36, width: w, height: h };
    }
  }
}

/** Fixed sizes the older gpt-image models accept. */
const FIXED_SIZES: [number, number][] = [
  [1024, 1024],
  [1024, 1536],
  [1536, 1024],
];

// gpt-image-2 accepts any size within these limits.
const MULTIPLE = 16;
const MAX_EDGE = 3824; // documented as "less than 3840"
const MAX_PIXELS = 8_294_400;
const MIN_PIXELS = 655_360;
const MAX_RATIO = 3;

/** Models that take a free-form size rather than one of FIXED_SIZES. */
export const flexibleSizeModel = (model: string) => !/^(gpt-image-1|dall-e)/.test(model);

/**
 * Pixel size to request for art that prints at `widthIn` x `heightIn`: print
 * resolution (300 DPI) when the model allows it, else the closest it can do.
 * The aspect ratio may differ slightly; the image is cropped to the box later.
 */
export function artRequestSize(model: string, widthIn: number, heightIn: number): { width: number; height: number } {
  const aspect = Math.min(MAX_RATIO, Math.max(1 / MAX_RATIO, widthIn / heightIn));
  if (!flexibleSizeModel(model)) {
    const [width, height] = FIXED_SIZES.reduce((best, s) => (Math.abs(Math.log(s[0] / s[1] / aspect)) < Math.abs(Math.log(best[0] / best[1] / aspect)) ? s : best));
    return { width, height };
  }
  let w = widthIn * MIN_IMAGE_DPI;
  let h = w / aspect;
  const shrink = Math.min(1, MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
  w *= shrink;
  h *= shrink;
  const grow = Math.max(1, Math.sqrt(MIN_PIXELS / (w * h)));
  w *= grow;
  h *= grow;
  const snap = (v: number, up: boolean) => Math.max(MULTIPLE, (up ? Math.ceil(v / MULTIPLE) : Math.floor(v / MULTIPLE)) * MULTIPLE);
  // Round up when that stays within limits, so small covers still reach 300 DPI.
  let width = snap(w, true);
  let height = snap(h, true);
  if (width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) {
    width = snap(w, false);
    height = snap(h, false);
  }
  return { width, height };
}

/**
 * Source rectangle that fills a box of `boxAspect` (width / height) from a
 * `w` x `h` image ("cover" fit): centered across, and `offsetY` of the way
 * down when the image is taller than the box (0.5 = centered).
 */
export function coverCrop(w: number, h: number, boxAspect: number, offsetY = 0.5): { sx: number; sy: number; sw: number; sh: number } {
  if (w / h > boxAspect) {
    const sw = Math.round(h * boxAspect);
    return { sx: Math.round((w - sw) / 2), sy: 0, sw, sh: h };
  }
  const sh = Math.round(w / boxAspect);
  return { sx: 0, sy: Math.round((h - sh) * Math.max(0, Math.min(1, offsetY))), sw: w, sh };
}

/** Vertical crop positions tried for full-bleed art, so the calmest part of the image sits under the title. */
export const CROP_OFFSETS = [0, 0.25, 0.5, 0.75, 1];

/**
 * Pixel size to store art at for a box of `box` points: 300 DPI, never less
 * than the source. Upscaling doesn't add detail, so the asset records the
 * source size and preflight reports the true resolution.
 */
export function artStoreSize(box: Box, cropW: number, cropH: number): { width: number; height: number; upscaled: boolean } {
  const targetW = Math.round(ptToIn(box.width) * MIN_IMAGE_DPI);
  if (cropW >= targetW) return { width: cropW, height: cropH, upscaled: false };
  return { width: targetW, height: Math.round((targetW * cropH) / cropW), upscaled: true };
}

/** Effective print DPI of art cropped to `cropW` px wide and printed `box.width` points wide. */
export const artDpi = (box: Box, cropW: number) => cropW / ptToIn(box.width);

/** Where the title sits over the art, as fractions of the art box. Prompts ask to keep this area calm. */
export const TITLE_ZONE: Record<ArtTemplateId, string> = {
  "art-full-bleed": "Keep the top third calm and uncluttered (soft sky, plain wall, gentle gradient): the title will be printed there.",
  "art-panel": "The image sits below the title, so the subject can fill the frame; keep the top edge simple.",
  "art-framed": "The image is shown inside a frame; center the subject with a little breathing room around it.",
};

/** Rules appended to every art prompt, whatever the model or user wrote. */
export const ART_RULES = [
  "Absolutely no text, letters, numbers, words, signatures or watermarks anywhere in the image.",
  "No logos, brands, trademarks, real people, celebrities, or characters from films, games, books or cartoons.",
  "Smooth color areas and crisp shapes (it is printed large and must upscale cleanly); no photographic noise or fine film grain.",
  "Family-friendly, print-ready, full color.",
];

/** Style when the book's genre doesn't name one. */
export const DEFAULT_ART_STYLE = "Flat illustration or clean painterly style";

/** The concept plus the cover's layout needs, the genre's style (see cover/genres) and the fixed rules. */
export function finalArtPrompt(concept: string, templateId: ArtTemplateId, style = DEFAULT_ART_STYLE): string {
  return `${concept.trim().replace(/\s+/g, " ")}\n\nThis is artwork for a printed book cover, portrait format. ${TITLE_ZONE[templateId]}\nStyle: ${style.trim().replace(/\.$/, "")}.\n${ART_RULES.map((r) => `- ${r}`).join("\n")}`;
}

/** Art layout that suits a book type when nothing else decides it. */
export function suggestArtTemplate(bookType: string): ArtTemplateId {
  if (bookType === "puzzle" || bookType === "activity") return "art-panel";
  if (bookType === "journal" || bookType === "notebook") return "art-framed";
  return "art-full-bleed";
}
