"use client";

import type { Asset } from "@/lib/schema/project";
import { newId, sha256Hex } from "@/lib/util/ids";

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

/**
 * Turn an uploaded file into a print asset. PNG/JPEG are kept as-is; WebP/GIF
 * are converted to PNG; SVG is rasterized (inside an <img>, so scripts never
 * run) at a print-friendly size.
 */
export async function fileToAsset(file: File, origin: Asset["origin"] = "user-upload"): Promise<Asset> {
  let dataUrl = await readAsDataUrl(file);
  let mime: Asset["mime"] = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const img = await loadImage(dataUrl);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    const scale = file.type === "image/svg+xml" ? Math.max(1, 3000 / Math.max(w || 300, h || 300)) : 1;
    w = Math.round((w || 300) * scale);
    h = Math.round((h || 300) * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    dataUrl = c.toDataURL("image/png");
    mime = "image/png";
  }
  return {
    id: newId("asset"),
    name: file.name,
    mime,
    dataUrl,
    widthPx: w,
    heightPx: h,
    origin,
    license: { license: "User-provided", author: "", source: "Uploaded by user", commercialUse: true, attribution: "" },
    contentHash: `sha256:${await sha256Hex(dataUrl)}`,
    createdAt: new Date().toISOString(),
  };
}
