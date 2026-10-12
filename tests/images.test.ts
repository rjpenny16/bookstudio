import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The image provider is server-only; vitest runs it in plain Node.
vi.mock("server-only", () => ({}));

const { CodexImageProvider, imageProvider, imageSize, imageStatus, OpenAIImageProvider } = await import("@/lib/ai/images");

const fetchMock = vi.fn();

describe("OpenAI image provider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_IMAGE_MODEL", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports status from the environment", () => {
    expect(imageStatus()).toMatchObject({ provider: "openai", model: "gpt-image-2", configured: true });
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(imageStatus()).toMatchObject({ provider: "none", configured: false });
    expect(() => imageProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it("requests print-size art and returns the image", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "/9j/AAAA" }] }), { status: 200 }));
    const img = await imageProvider().generate({ prompt: "A lighthouse, no text", widthIn: 6.25, heightIn: 9.25 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: "gpt-image-2", prompt: "A lighthouse, no text", n: 1, quality: "high", output_format: "jpeg" });
    const [w, h] = body.size.split("x").map(Number);
    expect(w / 6.25).toBeGreaterThanOrEqual(300);
    expect(w % 16).toBe(0);
    expect(img).toMatchObject({ data: "/9j/AAAA", mediaType: "image/jpeg", widthPx: w, heightPx: h, provider: "openai", model: "gpt-image-2" });
    expect(img.promptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("uses fixed sizes for gpt-image-1", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: "iVBORw0K" }] }), { status: 200 }));
    const img = await new OpenAIImageProvider("gpt-image-1", "k", "https://example.test/v1").generate({ prompt: "p", widthIn: 6, heightIn: 9 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).size).toBe("1024x1536");
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/v1/images/generations");
    expect(img.mediaType).toBe("image/png");
  });

  it("maps API errors to clear messages", async () => {
    const err = (status: number, error: object) => new Response(JSON.stringify({ error }), { status });
    fetchMock.mockResolvedValueOnce(err(401, { message: "bad key" }));
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toMatchObject({ status: 401, message: "OpenAI API key was rejected." });
    fetchMock.mockResolvedValueOnce(err(400, { message: "Your request was rejected by the safety system.", code: "moderation_blocked" }));
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toMatchObject({ status: 422 });
    fetchMock.mockResolvedValueOnce(err(429, { message: "slow down" }));
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toMatchObject({ status: 429 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toThrow(/no image/);
  });
});

describe("codex image provider (ChatGPT subscription)", () => {
  // An 8x8 PNG, as codex's image tool would save it.
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGO4YGCAFTEMLQkA2ntMAeuWKpoAAAAASUVORK5CYII=";
  // A fake codex on PATH: runs the real bridge script end to end without a ChatGPT account.
  const bin = mkdtempSync(path.join(tmpdir(), "fake-codex-"));
  writeFileSync(
    path.join(bin, "codex"),
    `#!/usr/bin/env bash
dir=""; prev=""
for a in "$@"; do [[ "$prev" == "-C" ]] && dir="$a"; prev="$a"; done
printf '%s' "\${@: -1}" > "${bin}/prompt.txt"
if [[ -n "$FAKE_CODEX_FAIL" ]]; then echo "$FAKE_CODEX_FAIL"; exit 1; fi
echo '${PNG}' | base64 -d > "$dir/out.png"
`,
  );
  chmodSync(path.join(bin, "codex"), 0o755);

  beforeEach(() => {
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("IMAGE_PROVIDER", "codex");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("FAKE_CODEX_FAIL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("takes precedence over an API key when IMAGE_PROVIDER=codex", () => {
    expect(imageStatus()).toMatchObject({ provider: "codex", configured: true });
    expect(imageProvider()).toBeInstanceOf(CodexImageProvider);
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(imageStatus().configured).toBe(true);
  });

  it("generates through the bundled bridge and reads the real pixel size", async () => {
    const img = await imageProvider().generate({ prompt: "A lighthouse at dusk, no text", widthIn: 6.25, heightIn: 9.25 });
    expect(img).toMatchObject({ data: PNG, mediaType: "image/png", widthPx: 8, heightPx: 8, provider: "codex" });
    expect(img.promptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const sent = readFileSync(path.join(bin, "prompt.txt"), "utf8");
    expect(sent).toContain("A lighthouse at dusk, no text");
    expect(sent).toMatch(/SIZE: \d+x\d+/);
  });

  it("explains codex failures", async () => {
    vi.stubEnv("FAKE_CODEX_FAIL", "Error: not logged in");
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("FAKE_CODEX_FAIL", "You've hit your usage limit");
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toMatchObject({ status: 429 });
    await expect(new CodexImageProvider("/nonexistent/bridge").generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toMatchObject({ status: 503, message: expect.stringContaining("/nonexistent/bridge") });
    vi.stubEnv("FAKE_CODEX_FAIL", "boom");
    await expect(imageProvider().generate({ prompt: "p", widthIn: 6, heightIn: 9 })).rejects.toThrow(/codex image generation failed: [\s\S]*boom/);
  });

  it("stops codex when the request is cancelled", async () => {
    const slow = path.join(bin, "slow-bridge");
    writeFileSync(slow, "sleep 30\n");
    const ac = new AbortController();
    const started = Date.now();
    const p = new CodexImageProvider(slow).generate({ prompt: "p", widthIn: 6, heightIn: 9 }, ac.signal);
    setTimeout(() => ac.abort(), 100);
    await expect(p).rejects.toMatchObject({ status: 499 });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("reads PNG and JPEG sizes", () => {
    expect(imageSize(Buffer.from(PNG, "base64"))).toEqual({ width: 8, height: 8 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x06, 0x00, 0x04, 0x00, 3, 1, 0x11, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 1024, height: 1536 });
    expect(imageSize(Buffer.from("nope"))).toBeNull();
  });
});
