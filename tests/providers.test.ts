import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The provider module is server-only; vitest runs it in plain Node.
vi.mock("server-only", () => ({}));

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});

const { runTask } = await import("@/lib/ai/providers");

const review = { score: 7, summary: "Clean cover.", thumbnailReadable: true, findings: [{ target: "Page 3 (Easy)", severity: "medium", issue: "Grid lines are faint.", suggestion: "Darken them." }] };
const input = { title: "Big Sudoku", bookType: "puzzle", audience: "seniors", trim: '8.5" x 11"', pageCount: 120, largePrint: true, images: ["Cover: back, spine and front", "Page 3 (Easy)"] };
const images = [
  { label: "Cover: back, spine and front", mediaType: "image/jpeg", data: "AAAA" },
  { label: "Page 3 (Easy)", mediaType: "image/jpeg", data: "BBBB" },
];

describe("vision tasks", () => {
  beforeEach(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("AI_PROVIDER", "");
    parse.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sends each image after its label, then the prompt", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: review });
    const res = await runTask("visual-review", input, images);
    expect(res.output).toEqual(review);
    const req = parse.mock.calls[0][0];
    expect(req.output_config.effort).toBe("high");
    const content = req.messages[0].content;
    expect(content.map((b: { type: string }) => b.type)).toEqual(["text", "image", "text", "image", "text"]);
    expect(content[0].text).toBe("Image: Cover: back, spine and front");
    expect(content[1].source).toEqual({ type: "base64", media_type: "image/jpeg", data: "AAAA" });
    expect(content[4].text).toContain("(2) Page 3 (Easy)");
    expect(content[4].text).toContain("large-print book");
  });

  it("refuses a vision task without images and ignores images on text tasks", async () => {
    await expect(runTask("visual-review", input, [])).rejects.toThrow(/needs at least one image/);
    parse.mockResolvedValue({ stop_reason: "end_turn", parsed_output: { phrases: ["Practice makes perfect."] } });
    await runTask("phrases", { topic: "t", audience: "a", count: 1, maxLength: 90, style: "saying" }, images);
    expect(typeof parse.mock.calls[0][0].messages[0].content).toBe("string");
  });

  it("rejects malformed images", async () => {
    await expect(runTask("visual-review", input, [{ label: "x", mediaType: "image/gif", data: "A" }])).rejects.toThrow(/Invalid images/);
  });
});
