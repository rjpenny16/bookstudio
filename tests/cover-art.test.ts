import { describe, expect, it } from "vitest";
import { assembleBook, planSections, validateBlueprint, type PlannedSection } from "@/lib/agent/blueprint";
import { recipeBlueprint } from "@/lib/agent/recipes";
import { offlineTask } from "@/lib/ai/offline";
import { taskPrompt } from "@/lib/ai/tasks";
import { ART_RULES, ART_TEMPLATES, artBox, artDpi, artRequestSize, artStoreSize, coverCrop, finalArtPrompt } from "@/lib/cover/art";
import { whatsInside } from "@/lib/cover/inside";
import { ART_COVER_TEMPLATES, buildCover, PALETTES, type ArtTone } from "@/lib/cover/templates";
import { coverGeometry, type Box } from "@/lib/kdp/geometry";
import { effectiveDpi, runPreflight } from "@/lib/preflight";
import { aiUsage } from "@/lib/preflight/aiUsage";
import { applyFix } from "@/lib/preflight/fixes";
import { checkDesign } from "@/lib/quality/design";
import { elementBounds } from "@/lib/schema/elements";
import { createProject } from "@/lib/schema/factory";
import type { Asset, Element, Project } from "@/lib/schema/project";
import { contrastRatio, lowContrastShare, mixHex, regionTone } from "@/lib/util/color";
import { inToPt, ptToIn } from "@/lib/util/ids";

const within = (b: Box, outer: Box, eps = 0.5) => b.x >= outer.x - eps && b.y >= outer.y - eps && b.x + b.width <= outer.x + outer.width + eps && b.y + b.height <= outer.y + outer.height + eps;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function puzzleBook(trimId = "8.5x11"): Project {
  const ctx = { bookType: "puzzle" as const, topic: "large print sudoku", audience: "seniors", notes: "" };
  const bp = validateBlueprint(recipeBlueprint(ctx), ctx).blueprint;
  const planned: PlannedSection[] = planSections(bp, { ...ctx, trimId, pageTarget: 120 });
  const sections = assembleBook(bp, planned, { ...ctx, trimId, pageTarget: 120, title: "Big Sudoku", subtitle: "Easy to hard", author: "Ada" });
  const p = createProject({ name: "Big Sudoku", bookType: "puzzle", trimId, paper: "white", ink: "black", bleed: false, author: "Ada", interior: sections });
  p.metadata.title = "Big Sudoku";
  p.metadata.author = "Ada";
  p.brief.topic = ctx.topic;
  p.brief.audience = ctx.audience;
  return p;
}

function artAssetFor(id: string, w: number, h: number, upscaledFrom?: { widthPx: number; heightPx: number }): Asset {
  return {
    id,
    name: "cover-art:Test",
    mime: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,",
    widthPx: w,
    heightPx: h,
    origin: "ai-generated",
    license: { license: "AI-generated image", author: "", source: "openai gpt-image-2", commercialUse: true },
    contentHash: "sha256:x",
    createdAt: "2026-10-11T00:00:00Z",
    ...(upscaledFrom ? { upscaledFrom } : {}),
  };
}

describe("art request sizes", () => {
  it("asks gpt-image-2 for 300 DPI within its limits", () => {
    for (const trimId of ["5x8", "6x9", "8.5x11"]) {
      const p = createProject({ name: "x", bookType: "journal", trimId, paper: "white", ink: "black", bleed: false });
      const cg = coverGeometry(p.spec, 120);
      for (const t of ART_TEMPLATES) {
        const box = artBox(t, cg);
        const { width, height } = artRequestSize("gpt-image-2", ptToIn(box.width), ptToIn(box.height));
        expect(width % 16, `${trimId}/${t}`).toBe(0);
        expect(height % 16).toBe(0);
        expect(Math.max(width, height)).toBeLessThan(3840);
        expect(width * height).toBeLessThanOrEqual(8_294_400);
        expect(width * height).toBeGreaterThanOrEqual(655_360);
        expect(Math.abs(width / height - box.width / box.height)).toBeLessThan(0.02);
        // Full 300 DPI unless the 8.3 MP cap gets in the way (8.5x11 full bleed is about 8.7 MP).
        expect(artDpi(box, width)).toBeGreaterThan(trimId === "8.5x11" && t === "art-full-bleed" ? 280 : 299);
      }
    }
  });

  it("uses the closest fixed size for older models", () => {
    expect(artRequestSize("gpt-image-1", 6.25, 9.25)).toEqual({ width: 1024, height: 1536 });
    expect(artRequestSize("gpt-image-1.5", 6.25, 4)).toEqual({ width: 1536, height: 1024 });
    expect(artRequestSize("gpt-image-1", 4.5, 4.4)).toEqual({ width: 1024, height: 1024 });
  });

  it("crops to the box and upscales only when short of 300 DPI", () => {
    const c = coverCrop(1024, 1536, 1);
    expect(c).toEqual({ sx: 0, sy: 256, sw: 1024, sh: 1024 });
    const wide = coverCrop(1536, 1024, 0.5);
    expect(wide.sw / wide.sh).toBeCloseTo(0.5, 2);
    const box = { x: 0, y: 0, width: inToPt(6), height: inToPt(9) };
    expect(artStoreSize(box, 1800, 2700)).toEqual({ width: 1800, height: 2700, upscaled: false });
    expect(artStoreSize(box, 1024, 1536)).toEqual({ width: 1800, height: 2700, upscaled: true });
  });
});

describe("art prompts", () => {
  it("always carries the no-text, no-trademark and title-space rules", () => {
    const p = finalArtPrompt("  A lighthouse at dusk,\n\nflat illustration ", "art-full-bleed");
    expect(p.startsWith("A lighthouse at dusk, flat illustration")).toBe(true);
    for (const rule of ART_RULES) expect(p).toContain(rule);
    expect(p).toMatch(/top third calm/);
    expect(finalArtPrompt("x", "art-panel")).not.toMatch(/top third/);
  });

  it("art direction prompt and offline fallback", () => {
    const input = { title: "Big Sudoku", subtitle: "", bookType: "puzzle", topic: "large print sudoku", audience: "seniors", coverDirection: "", count: 4 };
    expect(taskPrompt("cover-art-prompt", input)).toMatch(/no text/i);
    const out = offlineTask("cover-art-prompt", input);
    expect(out.concepts).toHaveLength(4);
    expect(new Set(out.concepts.map((c) => c.name)).size).toBe(4);
    expect(out.layout).toBe("art-panel");
    expect(offlineTask("cover-art-prompt", { ...input, bookType: "journal", count: 2 }).layout).toBe("art-framed");
  });
});

describe("image-aware cover templates", () => {
  const tones: (ArtTone | undefined)[] = [undefined, { mean: "#101820", spread: 0.03 }, { mean: "#f4efe6", spread: 0.04 }, { mean: "#808080", spread: 0.25 }];

  it("art fills its box, text stays in the safe zone and readable on every palette and art tone", () => {
    const p = puzzleBook();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    for (const t of ART_COVER_TEMPLATES)
      for (const palette of PALETTES)
        for (const tone of tones) {
          const label = `${t.id}/${palette.id}/${tone?.mean ?? "none"}`;
          const cover = buildCover(t.id, { title: "Large Print Sudoku Puzzles", subtitle: "Easy to hard puzzles for seniors", author: "Ada Writer", backText: "A back blurb.", palette, art: { assetId: "art1", runId: "run1", tone } }, cg);
          expect(cover.templateId, label).toBe(t.id);
          const art = cover.elements.find((e) => e.type === "image" && e.assetId === "art1")!;
          expect(art, label).toBeTruthy();
          expect({ x: art.x, y: art.y, width: art.width, height: art.height }).toEqual(artBox(t.id as (typeof ART_TEMPLATES)[number], cg));
          expect(art.provenance).toEqual({ origin: "ai-generated", runId: "run1" });
          for (const el of cover.elements) expect(within(elementBounds(el), { x: 0, y: 0, width: cg.width, height: cg.height }), `${label} ${el.name}`).toBe(true);
          const front = cover.elements.filter((e) => e.type === "text" && e.name !== "Spine text" && e.x > cg.spineBox.x);
          for (const el of front) expect(within(elementBounds(el), cg.frontSafe, 1), `${label} ${el.name}`).toBe(true);
          const project = { ...p, cover: { ...p.cover, ...cover } };
          const notes = checkDesign(project).filter((n) => n.area === "cover" && n.severity !== "low");
          expect(notes, label).toEqual([]);
          // On full bleed the title is read against the scrim with the art showing through.
          if (t.id === "art-full-bleed" && tone) {
            const plate = cover.elements.find((e) => e.name === "Title scrim")!;
            const title = cover.elements.find((e) => e.name === "Title")!;
            if (plate.type !== "rect" || title.type !== "text") throw new Error("shape");
            const seen = mixHex(plate.fill!, tone.mean, 1 - (plate.opacity ?? 1));
            expect(contrastRatio(title.color, seen)!, label).toBeGreaterThanOrEqual(3);
            expect(overlaps(elementBounds(title), elementBounds(plate))).toBe(true);
          }
        }
  });

  it("busy art gets a more opaque scrim than calm art", () => {
    const p = puzzleBook();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const plate = (tone: ArtTone) => buildCover("art-full-bleed", { title: "T", subtitle: "", author: "", backText: "", palette: PALETTES[0], art: { assetId: "a", tone } }, cg).elements.find((e) => e.name === "Title scrim")!.opacity!;
    expect(plate({ mean: "#202020", spread: 0.3 })).toBeGreaterThan(plate({ mean: "#202020", spread: 0.02 }));
  });

  it("falls back to a vector template without art", () => {
    const p = puzzleBook();
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const cover = buildCover("art-panel", { title: "T", subtitle: "", author: "", backText: "", palette: PALETTES[0] }, cg);
    expect(cover.templateId).toBe("minimal");
    expect(cover.elements.some((e) => e.type === "image")).toBe(false);
  });
});

describe("back cover", () => {
  it("lists what's inside from the sections", () => {
    const items = whatsInside(puzzleBook());
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.length).toBeLessThanOrEqual(5);
    expect(items.some((s) => /^Easy: \d+ sudoku puzzles/.test(s))).toBe(true);
    expect(items.at(-1)).toBe("Answer keys at the back");
    expect(items.some((s) => /divider|contents|title/i.test(s))).toBe(false);
  });

  it("fits blurb, list and page thumbnails above the barcode without overlap", () => {
    for (const trimId of ["5x8", "6x9", "8.5x11"]) {
      const p = puzzleBook(trimId);
      const cg = coverGeometry(p.spec, p.interior.pages.length);
      const blurb = "Keep your mind sharp with puzzles that start gentle and build to a real challenge. ".repeat(6);
      const cover = buildCover("band", { title: "Big Sudoku", subtitle: "", author: "Ada", backText: blurb, palette: PALETTES[0], inside: whatsInside(p), thumbs: ["t1", "t2", "t3"] }, cg);
      const back = cover.elements.filter((e) => e.x + e.width <= cg.spineBox.x);
      const groups = {
        blurb: back.filter((e) => e.name === "Back blurb"),
        list: back.filter((e) => e.name === "Inside heading" || e.name === "Inside item"),
        thumbs: back.filter((e) => e.type === "image"),
      };
      expect(groups.blurb, trimId).toHaveLength(1);
      expect(groups.list.length, trimId).toBeGreaterThan(2);
      expect(groups.thumbs, trimId).toHaveLength(3);
      for (const e of back) {
        const b = elementBounds(e);
        expect(within(b, cg.backSafe, 1), `${trimId} ${e.name}`).toBe(true);
        expect(overlaps(b, cg.barcode), `${trimId} ${e.name} hits barcode`).toBe(false);
      }
      const box = (els: Element[]) => els.map(elementBounds).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) }));
      expect(overlaps(box(groups.blurb), box(groups.list)), trimId).toBe(false);
      expect(overlaps(box(groups.list), box(groups.thumbs)), trimId).toBe(false);
      const t = groups.thumbs[0];
      expect(t.width / t.height).toBeCloseTo(cg.trimW / cg.trimH, 2);
    }
  });
});

describe("resolution and disclosure", () => {
  function withArt(asset: Asset): Project {
    const p = puzzleBook("6x9");
    const cg = coverGeometry(p.spec, p.interior.pages.length);
    const cover = buildCover("art-full-bleed", { title: "Big Sudoku", subtitle: "", author: "Ada", backText: "", palette: PALETTES[0], art: { assetId: asset.id, runId: "run_art" } }, cg);
    return { ...p, assets: [asset], cover: { ...p.cover, ...cover } };
  }

  it("preflight reports the real resolution of upscaled art", () => {
    const p0 = withArt(artAssetFor("a", 1900, 2850));
    const el = p0.cover.elements.find((e) => e.type === "image")!;
    if (el.type !== "image") throw new Error("no image");
    expect(effectiveDpi(p0, el)!).toBeGreaterThan(300);
    const up = withArt(artAssetFor("a", 1900, 2850, { widthPx: 1024, heightPx: 1536 }));
    expect(effectiveDpi(up, el)!).toBeCloseTo(Math.min(1024 / ptToIn(el.width), 1536 / ptToIn(el.height)), 5);
    const check = runPreflight(up).checks.find((c) => c.id === "images")!;
    expect(check.status).toBe("warn");
  });

  it("AI art pre-fills the KDP image disclosure", () => {
    const p = withArt(artAssetFor("a", 1900, 2850));
    expect(aiUsage(p).images).toBe(true);
    expect(applyFix(p, "suggest-ai-disclosure").metadata.aiDisclosure.images).toBe("some");
  });
});

describe("art tone measurement", () => {
  it("averages color and measures how busy a region is", () => {
    const flat = new Uint8ClampedArray(Array.from({ length: 100 }, () => [20, 40, 60, 255]).flat());
    expect(regionTone(flat).mean).toBe("#14283c");
    expect(regionTone(flat).spread).toBeCloseTo(0, 9);
    const noisy = new Uint8ClampedArray(Array.from({ length: 100 }, (_, i) => (i % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])).flat());
    expect(regionTone(noisy).spread).toBeGreaterThan(0.4);
    expect(lowContrastShare(noisy, "#ffffff")).toBeCloseTo(0.5, 5);
    expect(lowContrastShare(flat, "#ffffff")).toBe(0);
  });
});
