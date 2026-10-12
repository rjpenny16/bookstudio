import "server-only";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { artRequestSize } from "@/lib/cover/art";
import { codexPath, runCodex } from "./codex";

/**
 * Image generation for cover art, server-side only so API keys never reach
 * the browser. Providers sit behind one interface so an upscaler or another
 * image service can be added later without touching the callers.
 */

export interface ImageRequest {
  prompt: string;
  /** Printed size of the art box, inches. The provider picks the pixel size. */
  widthIn: number;
  heightIn: number;
}

export interface GeneratedImage {
  /** Base64 without a data: prefix. */
  data: string;
  mediaType: "image/png" | "image/jpeg";
  widthPx: number;
  heightPx: number;
  provider: string;
  model: string;
  promptHash: string;
}

export interface ImageProvider {
  name: string;
  model: string;
  generate(req: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage>;
}

export interface ImageStatus {
  provider: "openai" | "codex" | "none";
  model: string;
  configured: boolean;
  detail: string;
}

export class ImageError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

const openAiModel = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const codexSelected = () => process.env.IMAGE_PROVIDER?.trim().toLowerCase() === "codex";

export function imageStatus(): ImageStatus {
  if (codexSelected()) return { provider: "codex", model: CODEX_MODEL, configured: true, detail: "Cover art through the codex CLI on your ChatGPT subscription (no API key; about 2 to 6 minutes per image)" };
  if (process.env.OPENAI_API_KEY) return { provider: "openai", model: openAiModel(), configured: true, detail: "Cover art via the OpenAI Images API" };
  return { provider: "none", model: "", configured: false, detail: "No OPENAI_API_KEY or IMAGE_PROVIDER=codex set; covers use the built-in vector templates" };
}

export class OpenAIImageProvider implements ImageProvider {
  name = "openai";
  constructor(
    readonly model = openAiModel(),
    private readonly apiKey = process.env.OPENAI_API_KEY ?? "",
    private readonly baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    private readonly quality = process.env.OPENAI_IMAGE_QUALITY || "high",
  ) {}

  async generate(req: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    const { width, height } = artRequestSize(this.model, req.widthIn, req.heightIn);
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, prompt: req.prompt, n: 1, size: `${width}x${height}`, quality: this.quality, output_format: "jpeg", output_compression: 95 }),
      signal,
    }).catch((e: unknown) => {
      throw new ImageError(`Could not reach the OpenAI API: ${e instanceof Error ? e.message : e}`);
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string; code?: string } };
    if (!res.ok) {
      const msg = body.error?.message ?? `status ${res.status}`;
      if (res.status === 401) throw new ImageError("OpenAI API key was rejected.", 401);
      if (res.status === 429) throw new ImageError("Rate limited by the OpenAI API; try again shortly.", 429);
      if (res.status === 400 && /moderation|safety/i.test(`${body.error?.code} ${msg}`)) throw new ImageError(`OpenAI declined this prompt: ${msg}`, 422);
      throw new ImageError(`OpenAI image error ${res.status}: ${msg}`);
    }
    const data = body.data?.[0]?.b64_json;
    if (!data) throw new ImageError("OpenAI returned no image.");
    return {
      data,
      mediaType: data.startsWith("iVBOR") ? "image/png" : "image/jpeg",
      widthPx: width,
      heightPx: height,
      provider: this.name,
      model: this.model,
      promptHash: `sha256:${createHash("sha256").update(`${this.model}\n${width}x${height}\n${req.prompt}`).digest("hex")}`,
    };
  }
}

/** Codex picks the image backend itself; this label is for provenance only. */
export const CODEX_MODEL = "chatgpt-image";
const CODEX_TIMEOUT_MS = 10 * 60_000;

/** The gpt-image-bridge wrapper vendored as a Claude Code skill (see .claude/skills/gpt-image-bridge). */
export const codexBridgePath = () => process.env.CODEX_IMAGE_BRIDGE || path.join(process.cwd(), ".claude/skills/gpt-image-bridge/bin/gpt-image-2");

export { bridgeShell, noBash } from "./codex";

/** Pixel size from a PNG or JPEG header, or null when it can't be read. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // SOF0..SOF15, minus DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * Cover art through the codex CLI and the user's ChatGPT subscription, using
 * the gpt-image-bridge wrapper. Slow (codex reasons before it draws) but no
 * API key and no per-image billing. Runs on the machine serving the app, so
 * codex must be installed and logged in there.
 */
export class CodexImageProvider implements ImageProvider {
  name = "codex";
  model = CODEX_MODEL;
  constructor(
    private readonly bridge = codexBridgePath(),
    private readonly timeoutMs = CODEX_TIMEOUT_MS,
  ) {}

  async generate(req: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    // A size hint at the cover's aspect; codex may return a different size, so the real one is read from the file.
    const hint = artRequestSize("gpt-image-2", req.widthIn, req.heightIn);
    await access(this.bridge).catch(() => {
      throw new ImageError(`The image bridge isn't at ${this.bridge}. Set CODEX_IMAGE_BRIDGE or restore .claude/skills/gpt-image-bridge.`, 503);
    });
    const dir = await mkdtemp(path.join(tmpdir(), "bookstudio-art-"));
    const out = path.join(dir, "art.png");
    try {
      // The bridge's dirname/basename split only on /, so Windows paths go over as C:/...
      await this.run([req.prompt, codexPath(out), "--size", `${hint.width}x${hint.height}`], dir, signal);
      const buf = await readFile(out).catch(() => {
        throw new ImageError("codex finished but saved no image.");
      });
      const size = imageSize(buf);
      if (!size) throw new ImageError("codex returned a file that isn't a PNG or JPEG.");
      return {
        data: buf.toString("base64"),
        mediaType: buf[0] === 0x89 ? "image/png" : "image/jpeg",
        widthPx: size.width,
        heightPx: size.height,
        provider: this.name,
        model: this.model,
        promptHash: `sha256:${createHash("sha256").update(`${this.model}\n${size.width}x${size.height}\n${req.prompt}`).digest("hex")}`,
      };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private run(args: string[], dir: string, signal?: AbortSignal): Promise<void> {
    return runCodex({ args: [this.bridge, ...args], dir, timeoutMs: this.timeoutMs, signal, what: "image generation", fail: (msg, status) => new ImageError(msg, status) });
  }
}

export function imageProvider(): ImageProvider {
  if (!imageStatus().configured) throw new ImageError("No image provider configured. Set OPENAI_API_KEY, or IMAGE_PROVIDER=codex to use a ChatGPT subscription.", 503);
  return codexSelected() ? new CodexImageProvider() : new OpenAIImageProvider();
}
