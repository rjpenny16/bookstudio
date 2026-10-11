import "server-only";
import { createHash } from "node:crypto";
import { artRequestSize } from "@/lib/cover/art";

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
  provider: "openai" | "none";
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

export function imageStatus(): ImageStatus {
  if (process.env.OPENAI_API_KEY) return { provider: "openai", model: openAiModel(), configured: true, detail: "Cover art via the OpenAI Images API" };
  return { provider: "none", model: "", configured: false, detail: "No OPENAI_API_KEY set; covers use the built-in vector templates" };
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

export function imageProvider(): ImageProvider {
  if (!imageStatus().configured) throw new ImageError("No image provider configured. Set OPENAI_API_KEY on the server.", 503);
  return new OpenAIImageProvider();
}
