"use client";

import { useEffect, useRef, useState } from "react";
import { ensureFonts, loadImages, rasterize, type ImageCache } from "@/lib/render/canvas";
import type { Asset, Element } from "@/lib/schema/project";

/** Rendered images per page and pixel width, so a 72 px strip thumbnail is never stretched into a large preview. */
const cache = new WeakMap<Element[], Map<number, string>>();
const imageCache: ImageCache = new Map();

/** Pixel width to render `px` CSS pixels at on this screen (sharp on high-density displays, capped to keep memory sane). */
const renderWidth = (px: number) => Math.round(px * Math.min(3, Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1)));

/** Lazily rendered page thumbnail (renders only when scrolled into view). */
export function PageThumb({ elements, widthPt, heightPt, assets, background = "#ffffff", px = 150, alt, originX = 0, originY = 0 }: { elements: Element[]; widthPt: number; heightPt: number; assets: Asset[]; background?: string; px?: number; alt: string; originX?: number; originY?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<{ key: Element[]; px: number; src: string } | null>(null);
  const width = renderWidth(px);
  const src = cache.get(elements)?.get(width) ?? (rendered?.key === elements && rendered.px === width ? rendered.src : null);
  useEffect(() => {
    if (cache.get(elements)?.has(width)) return;
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        await ensureFonts();
        if (assets.length) await loadImages(assets, imageCache);
        if (cancelled) return;
        const canvas = rasterize({ widthPt, heightPt, scale: width / widthPt, background, elements, images: imageCache, originX, originY });
        const url = canvas.toDataURL("image/png");
        if (!cache.has(elements)) cache.set(elements, new Map());
        cache.get(elements)!.set(width, url);
        setRendered({ key: elements, px: width, src: url });
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [elements, widthPt, heightPt, assets, background, width, originX, originY]);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {src ? <img src={src} alt={alt} /> : <div className="page-thumb-ph" style={{ ["--ratio" as string]: `${widthPt / heightPt}` }} aria-label={alt} />}
    </div>
  );
}
