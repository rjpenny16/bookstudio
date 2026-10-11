"use client";

import { useEffect, useRef, useState } from "react";
import { ensureFonts, loadImages, rasterize, type ImageCache } from "@/lib/render/canvas";
import type { Asset, Element } from "@/lib/schema/project";

const cache = new WeakMap<Element[], string>();
const imageCache: ImageCache = new Map();

/** Lazily rendered page thumbnail (renders only when scrolled into view). */
export function PageThumb({ elements, widthPt, heightPt, assets, background = "#ffffff", px = 150, alt, originX = 0, originY = 0 }: { elements: Element[]; widthPt: number; heightPt: number; assets: Asset[]; background?: string; px?: number; alt: string; originX?: number; originY?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<{ key: Element[]; src: string } | null>(null);
  const src = cache.get(elements) ?? (rendered?.key === elements ? rendered.src : null);
  useEffect(() => {
    if (cache.has(elements)) return;
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
        const canvas = rasterize({ widthPt, heightPt, scale: px / widthPt, background, elements, images: imageCache, originX, originY });
        const url = canvas.toDataURL("image/png");
        cache.set(elements, url);
        setRendered({ key: elements, src: url });
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [elements, widthPt, heightPt, assets, background, px, originX, originY]);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {src ? <img src={src} alt={alt} /> : <div className="page-thumb-ph" style={{ ["--ratio" as string]: `${widthPt / heightPt}` }} aria-label={alt} />}
    </div>
  );
}
