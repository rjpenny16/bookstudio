import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The image provider is server-only; vitest runs it in plain Node.
vi.mock("server-only", () => ({}));

const { imageProvider, imageStatus, OpenAIImageProvider } = await import("@/lib/ai/images");

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
