import "server-only";
import { execFile } from "node:child_process";
import { openSync, readSync, closeSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { bridgeShell, codexBridgePath, noBash, imageStatus, type ImageStatus } from "./images";
import { providerStatus, type ProviderStatus } from "./providers";

/**
 * What the server can do right now (text model, vision review, cover art) and
 * cheap live checks of each. Keys stay in the server's environment; nothing
 * here is sent to the browser except the result.
 */

export type Capability = "text" | "vision" | "images";

export interface Capabilities {
  text: ProviderStatus;
  /** true: the text model reads images; null: depends on the local model (test it); false: not available. */
  vision: { available: boolean | null; detail: string };
  images: ImageStatus;
  /** Problems with the server's .env files that would silently drop settings. */
  envWarnings: string[];
}

export interface ConnectionResult {
  ok: boolean;
  detail: string;
  ms: number;
}

export function capabilities(): Capabilities {
  const text = providerStatus();
  const vision =
    text.provider === "anthropic"
      ? { available: true, detail: "Claude reviews the rendered cover and pages and picks cover art" }
      : text.provider === "ollama"
        ? { available: null, detail: `Depends on whether ${text.model} is a vision model; use Test connection to check` }
        : { available: false, detail: "Offline mode can't look at images; rule-based design checks still run" };
  return { text, vision, images: imageStatus(), envWarnings: envWarnings() };
}

const ENV_FILES = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"];

/**
 * .env files Next.js can't read. PowerShell 5's `echo X > .env` writes UTF-16,
 * which Next.js reads as garbage, so every setting in the file is ignored.
 */
export function envWarnings(dir = process.cwd()): string[] {
  return ENV_FILES.flatMap((name) => {
    let head: Buffer;
    try {
      const fd = openSync(path.join(dir, name), "r");
      head = Buffer.alloc(2);
      readSync(fd, head, 0, 2, 0);
      closeSync(fd);
    } catch {
      return [];
    }
    const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
    return utf16 ? [`${name} is saved as UTF-16, so none of its settings are loaded. Re-save it as UTF-8 (in Notepad: Save as, Encoding: UTF-8) and restart the server.`] : [];
  });
}

/** An 8×8 red PNG: the smallest useful image for a vision check. */
const RED_PIXELS = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4YGCAFTEMLQkA2ntMAeuWKpoAAAAASUVORK5CYII=";

async function claude(model: string, withImage: boolean): Promise<string> {
  const client = new Anthropic();
  const question = withImage ? "What color is this image? Answer with one word." : "Reply with the single word OK.";
  const response = await client.beta.messages.create({
    model,
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: withImage ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: RED_PIXELS } }, { type: "text", text: question }] : question,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined the test request.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text.trim()] : [])).join(" ");
  return `${response.model} replied "${text.slice(0, 40) || "(empty)"}"`;
}

function anthropicError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Anthropic API key was rejected.";
  if (err instanceof Anthropic.NotFoundError) return "The model in ANTHROPIC_MODEL isn't available to this key.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API; the key works, try again shortly.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

const ollamaBase = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

async function ollamaJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${ollamaBase()}${path}`, { ...init, signal: AbortSignal.timeout(10_000) }).catch((e: unknown) => {
    throw new Error(`Could not reach Ollama at ${ollamaBase()}: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  return res.json();
}

async function testText(): Promise<string> {
  const s = providerStatus();
  if (s.provider === "anthropic") return claude(s.model, false);
  if (s.provider === "ollama") {
    const tags = (await ollamaJson("/api/tags")) as { models?: { name: string }[] };
    const names = (tags.models ?? []).map((m) => m.name);
    if (!names.some((n) => n === s.model || n === `${s.model}:latest`)) throw new Error(`Ollama is running but ${s.model} isn't pulled. Run: ollama pull ${s.model}`);
    return `Ollama is running and ${s.model} is available`;
  }
  return "Offline mode: nothing to connect to. Built-in heuristics are always available.";
}

async function testVision(): Promise<string> {
  const s = providerStatus();
  if (s.provider === "anthropic") return claude(s.model, true);
  if (s.provider === "ollama") {
    const info = (await ollamaJson("/api/show", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: s.model }) })) as { capabilities?: string[] };
    if (!info.capabilities) throw new Error("This Ollama version doesn't report model capabilities; try a visual review to check.");
    if (!info.capabilities.includes("vision")) throw new Error(`${s.model} can't read images. Pick a vision model (for example a Qwen-VL or Gemma 3 model) in OLLAMA_MODEL.`);
    return `${s.model} can read images`;
  }
  throw new Error("Offline mode can't look at images.");
}

/** codex is installed, logged in with ChatGPT, and the bridge script is in place. Generates nothing. */
async function testCodex(): Promise<string> {
  const bridge = codexBridgePath();
  await access(bridge, constants.R_OK).catch(() => {
    throw new Error(`The image bridge isn't at ${bridge}. Set CODEX_IMAGE_BRIDGE or restore .claude/skills/gpt-image-bridge.`);
  });
  const status = await new Promise<string>((resolve, reject) =>
    // Through the bridge's own bash, so this sees the same codex that image generation will.
    execFile(bridgeShell(), ["-c", "codex login status"], { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
      const text = `${stdout}${stderr}`.trim();
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code === "ENOENT") reject(new Error(noBash()));
      else if ((code as unknown) === 127) reject(new Error("codex CLI isn't installed on the server. Run: npm install -g @openai/codex, then codex login"));
      else if (err) reject(new Error(`codex isn't logged in. Run: codex login${text ? ` (${text.split("\n")[0]})` : ""}`));
      else resolve(text);
    }),
  );
  if (/api key/i.test(status) && !/chatgpt/i.test(status)) throw new Error(`codex is logged in with an API key, not ChatGPT, so images would be billed per call. Run: codex login`);
  return `codex is logged in (${status.split("\n")[0] || "ok"}); no image was generated`;
}

/** Looks the model up instead of generating an image, so the check costs nothing. */
async function testImages(): Promise<string> {
  const s = imageStatus();
  if (!s.configured) throw new Error("No image provider set on the server (OPENAI_API_KEY or IMAGE_PROVIDER=codex).");
  if (s.provider === "codex") return testCodex();
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/models/${encodeURIComponent(s.model)}`, { headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(10_000) }).catch((e: unknown) => {
    throw new Error(`Could not reach the OpenAI API: ${e instanceof Error ? e.message : e}`);
  });
  if (res.status === 401) throw new Error("OpenAI API key was rejected.");
  if (res.status === 404) throw new Error(`${s.model} isn't available to this key (check OPENAI_IMAGE_MODEL and your organization's verification).`);
  if (!res.ok) throw new Error(`OpenAI returned ${res.status}`);
  return `Key accepted and ${s.model} is available (no image was generated)`;
}

export async function testConnection(what: Capability): Promise<ConnectionResult> {
  const start = Date.now();
  try {
    const detail = what === "text" ? await testText() : what === "vision" ? await testVision() : await testImages();
    return { ok: true, detail, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, detail: anthropicError(err), ms: Date.now() - start };
  }
}
