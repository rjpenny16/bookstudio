"use client";

/** A simple 3D-ish paperback mockup drawn from the rendered front cover and spine. */
export function renderMockup(front: HTMLCanvasElement, spine: HTMLCanvasElement | null, opts: { width?: number; background?: string } = {}): HTMLCanvasElement {
  const W = opts.width ?? 1600;
  const H = Math.round(W * 0.75);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, opts.background ?? "#eef0f3");
  bg.addColorStop(1, "#d9dce1");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const bookH = H * 0.78;
  const bookW = (front.width / front.height) * bookH;
  const spineW = spine ? Math.max(bookH * 0.035, Math.min(bookH * 0.12, (spine.width / spine.height) * bookH)) : bookH * 0.04;
  const skew = 0.07;
  const x0 = (W - bookW - spineW * 0.6) / 2 + spineW * 0.6;
  const y0 = (H - bookH) / 2;

  // Floor shadow
  ctx.save();
  ctx.filter = "blur(18px)";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(x0 + bookW / 2, y0 + bookH + 6, bookW * 0.56, bookH * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spine face
  ctx.save();
  // Parallelogram whose right edge meets the front cover's left edge at y0.
  ctx.setTransform(0.6, -skew * 1.8, 0, 1, x0 - spineW * 0.6, y0 + spineW * skew * 1.8);
  if (spine) ctx.drawImage(spine, 0, 0, spineW, bookH);
  else {
    ctx.fillStyle = "#555";
    ctx.fillRect(0, 0, spineW, bookH);
  }
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, spineW, bookH);
  ctx.restore();

  // Front face
  ctx.save();
  ctx.setTransform(1, -skew * 0.15, 0, 1, x0, y0);
  ctx.drawImage(front, 0, 0, bookW, bookH);
  const sheen = ctx.createLinearGradient(0, 0, bookW, 0);
  sheen.addColorStop(0, "rgba(0,0,0,0.18)");
  sheen.addColorStop(0.04, "rgba(255,255,255,0.10)");
  sheen.addColorStop(0.1, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.06)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, bookW, bookH);
  ctx.restore();
  return canvas;
}
