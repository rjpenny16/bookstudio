import "server-only";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

/**
 * The bash that runs the bridge. On Windows that's Git for Windows' bash: it
 * isn't on PATH for a server started from PowerShell, and System32\bash.exe is
 * WSL, which can't see a Windows codex. CODEX_BASH overrides it.
 */
export function bridgeShell(): string {
  if (process.env.CODEX_BASH) return process.env.CODEX_BASH;
  if (process.platform !== "win32") return "bash";
  const roots = [process.env.ProgramFiles, process.env["ProgramW6432"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")];
  return roots.map((r) => r && path.join(r, "Git", "bin", "bash.exe")).find((p): p is string => !!p && existsSync(p)) ?? "bash";
}

export const noBash = () =>
  process.platform === "win32"
    ? "Git for Windows (its bash) is needed to run the image bridge. Install it from https://git-scm.com, or set CODEX_BASH to a bash.exe."
    : "bash is needed to run the image bridge.";

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
      await this.run([req.prompt, out.replaceAll("\\", "/"), "--size", `${hint.width}x${hint.height}`], dir, signal);
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

  /** `dir` is this request's own temp dir; the bridge's codex workdir goes inside it, so it's in codex's command line. */
  private run(args: string[], dir: string, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new ImageError("Image request was cancelled.", 499));
      const win = process.platform === "win32";
      // Its own process group, so cancelling stops codex too and not just the wrapper.
      const child = spawn(bridgeShell(), [this.bridge, ...args], { detached: !win, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TMPDIR: dir } });
      let stderr = "";
      let why: ImageError | null = null;
      const kill = (err: ImageError) => {
        why = err;
        if (win) {
          // Git bash's processes don't form a Windows process tree taskkill /T can follow, so codex is found by
          // its workdir instead (the temp dir name is unique to this request and contains only safe characters).
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
          const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${path.basename(dir)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
          execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true }, () => {});
          return;
        }
        try {
          process.kill(-child.pid!, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      };
      const timer = setTimeout(() => kill(new ImageError(`codex took longer than ${Math.round(this.timeoutMs / 60_000)} minutes; try again.`, 504)), this.timeoutMs);
      const onAbort = () => kill(new ImageError("Image request was cancelled.", 499));
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stderr!.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString()).slice(-4000);
      });
      const done = (err: ImageError | null) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (err) reject(err);
        else resolve();
      };
      child.on("error", (e) => done(new ImageError((e as NodeJS.ErrnoException).code === "ENOENT" ? noBash() : `Could not run the image bridge at ${this.bridge}: ${e.message}`, 503)));
      // A stopped request settles as soon as the wrapper exits; a straggler holding stderr open mustn't keep it waiting.
      child.on("exit", () => why && done(why));
      child.on("close", (code) => {
        if (why) return done(why);
        if (code === 0) return done(null);
        if (code === 127) return done(new ImageError("codex CLI not found on the server. Install it (npm install -g @openai/codex) and run: codex login", 503));
        const tail = stderr.trim().split("\n").slice(-6).join("\n");
        if (/not logged in|codex login|unauthori[sz]ed|\b401\b/i.test(tail)) return done(new ImageError("codex isn't logged in. Run: codex login (with your ChatGPT account)", 401));
        if (/rate.?limit|usage limit|\b429\b/i.test(tail)) return done(new ImageError("ChatGPT usage limit reached; try again later.", 429));
        done(new ImageError(`codex image generation failed${tail ? `: ${tail}` : ` (exit ${code})`}`));
      });
    });
  }
}

export function imageProvider(): ImageProvider {
  if (!imageStatus().configured) throw new ImageError("No image provider configured. Set OPENAI_API_KEY, or IMAGE_PROVIDER=codex to use a ChatGPT subscription.", 503);
  return codexSelected() ? new CodexImageProvider() : new OpenAIImageProvider();
}
