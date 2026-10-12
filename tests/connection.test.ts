import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The connection module is server-only; vitest runs it in plain Node.
vi.mock("server-only", () => ({}));

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static NotFoundError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static APIConnectionError = class extends APIError {};
    beta = { messages: { create, parse: vi.fn() } };
  }
  return { default: Anthropic };
});

const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { capabilities, testConnection } = await import("@/lib/ai/connection");
const fetchMock = vi.fn();

describe("capabilities and connection tests", () => {
  beforeEach(() => {
    create.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-opus-5-5");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_IMAGE_MODEL", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports what is active", () => {
    expect(capabilities()).toMatchObject({ text: { provider: "anthropic", model: "claude-opus-5-5" }, vision: { available: true }, images: { configured: true, model: "gpt-image-2" } });
    vi.stubEnv("AI_PROVIDER", "offline");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(capabilities()).toMatchObject({ text: { provider: "offline" }, vision: { available: false }, images: { configured: false } });
    vi.stubEnv("AI_PROVIDER", "ollama");
    expect(capabilities().vision.available).toBeNull();
  });

  it("makes one small Claude call for text, and sends an image for vision", async () => {
    create.mockResolvedValue({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "OK" }] });
    const text = await testConnection("text");
    expect(text).toMatchObject({ ok: true, detail: 'claude-opus-5-5 replied "OK"' });
    const req = create.mock.calls[0][0];
    expect(req).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" }, fallbacks: "default" });
    expect(req.max_tokens).toBeLessThanOrEqual(4096);
    expect(typeof req.messages[0].content).toBe("string");

    create.mockResolvedValue({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Red" }] });
    expect(await testConnection("vision")).toMatchObject({ ok: true, detail: expect.stringContaining("Red") });
    const blocks = create.mock.calls[1][0].messages[0].content;
    expect(blocks[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
    expect(Buffer.from(blocks[0].source.data, "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  it("explains a rejected key and a missing model", async () => {
    create.mockRejectedValue(Object.create(Anthropic.AuthenticationError.prototype));
    expect(await testConnection("text")).toMatchObject({ ok: false, detail: "Anthropic API key was rejected." });
    create.mockRejectedValue(Object.create(Anthropic.NotFoundError.prototype));
    expect((await testConnection("text")).detail).toMatch(/ANTHROPIC_MODEL/);
  });

  it("checks the image model without generating an image", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await testConnection("images")).toMatchObject({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/models/gpt-image-2");
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers.authorization).toBe("Bearer sk-test");
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    expect((await testConnection("images")).detail).toMatch(/isn't available to this key/);
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    expect((await testConnection("images")).detail).toMatch(/rejected/);
  });

  it("checks codex login for the ChatGPT-subscription image provider", async () => {
    const bin = mkdtempSync(path.join(tmpdir(), "fake-codex-"));
    writeFileSync(path.join(bin, "codex"), `#!/usr/bin/env bash\n[[ -n "$FAKE_LOGGED_OUT" ]] && { echo "Not logged in" >&2; exit 1; }\necho "Logged in using ChatGPT"\n`);
    chmodSync(path.join(bin, "codex"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    vi.stubEnv("IMAGE_PROVIDER", "codex");
    expect(capabilities().images).toMatchObject({ provider: "codex", configured: true });
    expect(await testConnection("images")).toMatchObject({ ok: true, detail: expect.stringContaining("Logged in using ChatGPT") });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("FAKE_LOGGED_OUT", "1");
    expect((await testConnection("images")).detail).toMatch(/codex login/);
    vi.stubEnv("CODEX_IMAGE_BRIDGE", "/nonexistent/bridge");
    expect((await testConnection("images")).detail).toMatch(/image bridge isn't at/);
  });

  it("checks Ollama's model list and vision capability", async () => {
    vi.stubEnv("AI_PROVIDER", "ollama");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:8b");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "llama3:latest" }] })));
    expect((await testConnection("text")).detail).toMatch(/ollama pull qwen3:8b/);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] })));
    expect(await testConnection("text")).toMatchObject({ ok: true });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ capabilities: ["completion"] })));
    expect((await testConnection("vision")).detail).toMatch(/can't read images/);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ capabilities: ["completion", "vision"] })));
    expect(await testConnection("vision")).toMatchObject({ ok: true });
  });

  it("does nothing offline and says so", async () => {
    vi.stubEnv("AI_PROVIDER", "offline");
    expect(await testConnection("text")).toMatchObject({ ok: true, detail: expect.stringMatching(/Offline mode/) });
    expect(await testConnection("vision")).toMatchObject({ ok: false });
    expect(create).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
