import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

const { extractJson, providerStatus, resetCodexLegacy, runTask, strictSchema } = await import("@/lib/ai/providers");

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

describe("codex writing provider (ChatGPT subscription)", () => {
  // A fake codex on PATH: records its arguments and stdin, then writes $FAKE_REPLY (or the next of $FAKE_REPLIES) as its last message.
  const bin = mkdtempSync(path.join(tmpdir(), "fake-codex-text-"));
  writeFileSync(
    path.join(bin, "codex"),
    `#!/usr/bin/env bash
out=""; prev=""; imgs=0
rm -f "${bin}/schema.json"
for a in "$@"; do
  [[ "$prev" == "-o" ]] && out="$a"
  [[ "$prev" == "--image" && -s "$a" ]] && imgs=$((imgs+1))
  [[ "$prev" == "--output-schema" ]] && cp "$a" "${bin}/schema.json"
  [[ "$a" == "--output-schema" && -n "$FAKE_LEGACY" ]] && legacy=1
  prev="$a"
done
printf '%s\\n' "$@" > "${bin}/args.txt"
echo "$imgs" > "${bin}/images.txt"
cat > "${bin}/stdin.txt"
n=$(cat "${bin}/calls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${bin}/calls"
[[ -n "$legacy" ]] && { echo "error: unexpected argument '--output-schema' found" >&2; exit 2; }
[[ -n "$FAKE_CODEX_FAIL" ]] && { echo "$FAKE_CODEX_FAIL" >&2; exit 1; }
if [[ -n "$FAKE_REPLIES" ]]; then IFS='|' read -ra r <<< "$FAKE_REPLIES"; printf '%s' "\${r[$((n-1))]}" > "$out"; else printf '%s' "$FAKE_REPLY" > "$out"; fi
`,
  );
  chmodSync(path.join(bin, "codex"), 0o755);
  const phrasesInput = { topic: "gardening", audience: "seniors", count: 1, maxLength: 90, style: "saying" };
  const read = (f: string) => readFileSync(path.join(bin, f), "utf8");

  beforeEach(() => {
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv("AI_PROVIDER", "codex");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CODEX_TEXT_MODEL", "");
    vi.stubEnv("FAKE_CODEX_FAIL", "");
    vi.stubEnv("FAKE_REPLIES", "");
    vi.stubEnv("FAKE_LEGACY", "");
    writeFileSync(path.join(bin, "calls"), "0");
    resetCodexLegacy();
    parse.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is chosen by AI_PROVIDER=codex even with an Anthropic key", () => {
    expect(providerStatus()).toMatchObject({ provider: "codex", model: "chatgpt", configured: true });
    vi.stubEnv("CODEX_TEXT_MODEL", "gpt-5.5");
    expect(providerStatus().model).toBe("gpt-5.5");
  });

  it("runs codex exec read-only and ephemeral, enforces the reply's shape with a strict schema and validates it", async () => {
    vi.stubEnv("FAKE_REPLY", 'Here you go:\n```json\n{"phrases":["Bloom where you are planted."]}\n```');
    const res = await runTask("phrases", phrasesInput);
    expect(res.output).toEqual({ phrases: ["Bloom where you are planted."] });
    expect(res.meta).toMatchObject({ provider: "codex", model: "chatgpt", task: "phrases" });
    expect(res.meta.ms).toBeGreaterThanOrEqual(0);
    expect(parse).not.toHaveBeenCalled();
    const args = read("args.txt").trim().split("\n");
    expect(args.slice(0, 5)).toEqual(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color"]);
    expect(args).toContain('model_reasoning_effort="medium"');
    expect(args).toContain("--ephemeral");
    expect(args[args.indexOf("--output-schema") + 1]).toMatch(/schema\.json$/);
    expect(args.slice(-2)).toEqual(["--", "-"]);
    expect(args).not.toContain("-m");
    expect(JSON.parse(read("schema.json"))).toEqual({
      type: "object",
      properties: { phrases: { type: "array", items: { type: "string" } } },
      required: ["phrases"],
      additionalProperties: false,
    });
    const stdin = read("stdin.txt");
    expect(stdin).toContain("gardening");
    expect(stdin).not.toMatch(/JSON Schema/);
  });

  it("falls back to the schema in the prompt on a codex without --output-schema, and remembers", async () => {
    vi.stubEnv("FAKE_LEGACY", "1");
    vi.stubEnv("FAKE_REPLY", '{"phrases":["Grow slow."]}');
    expect((await runTask("phrases", phrasesInput)).output).toEqual({ phrases: ["Grow slow."] });
    expect(read("calls").trim()).toBe("2");
    expect(read("args.txt")).not.toContain("--output-schema");
    expect(read("stdin.txt")).toMatch(/JSON Schema/);
    await runTask("phrases", phrasesInput);
    expect(read("calls").trim()).toBe("3");
  });

  it("can be told to use the built-in heuristics instead", async () => {
    const res = await runTask("phrases", { ...phrasesInput, count: 3 }, [], undefined, true);
    expect(res.meta.provider).toBe("offline");
    expect(res.output.phrases).toHaveLength(3);
    expect(read("calls").trim()).toBe("0");
  });

  it("reports smaller batches and fewer calls at once for codex", () => {
    expect(providerStatus().limits).toMatchObject({ concurrency: 2, batch: { "crossword-clues": 4, "word-lists": 8 } });
    vi.stubEnv("CODEX_CONCURRENCY", "4");
    expect(providerStatus().limits.concurrency).toBe(4);
    vi.stubEnv("AI_PROVIDER", "anthropic");
    expect(providerStatus().limits.batch["crossword-clues"]).toBe(30);
  });

  it("makes every task's output schema strict", () => {
    const s = strictSchema({ $schema: "x", type: "object", properties: { n: { type: "integer", minimum: -9e15, maximum: 9e15 }, type: { type: "string" } } });
    expect(s).toEqual({ type: "object", properties: { n: { type: "integer" }, type: { type: "string" } }, required: ["n", "type"], additionalProperties: false });
  });

  it("attaches vision images and passes CODEX_TEXT_MODEL", async () => {
    vi.stubEnv("CODEX_TEXT_MODEL", "gpt-5.5");
    vi.stubEnv("FAKE_REPLY", JSON.stringify(review));
    const res = await runTask("visual-review", input, images);
    expect(res.output).toEqual(review);
    expect(read("images.txt").trim()).toBe("2");
    const args = read("args.txt").trim().split("\n");
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.5");
    expect(args).toContain('model_reasoning_effort="high"');
    expect(read("stdin.txt")).toContain("2. Page 3 (Easy)");
  });

  it("retries once with the problem named, then gives up", async () => {
    vi.stubEnv("FAKE_REPLIES", '{"phrases":"nope"}|{"phrases":["Grow slow."]}');
    expect((await runTask("phrases", phrasesInput)).output).toEqual({ phrases: ["Grow slow."] });
    expect(read("calls").trim()).toBe("2");
    expect(read("stdin.txt")).toMatch(/previous reply was rejected \(phrases:/);
    writeFileSync(path.join(bin, "calls"), "0");
    vi.stubEnv("FAKE_REPLIES", "");
    vi.stubEnv("FAKE_REPLY", "I can't help with that.");
    await expect(runTask("phrases", phrasesInput)).rejects.toThrow(/did not match the schema \(it was not valid JSON\)/);
    expect(read("calls").trim()).toBe("2");
  });

  it("explains codex failures", async () => {
    vi.stubEnv("FAKE_CODEX_FAIL", "Error: not logged in");
    await expect(runTask("phrases", phrasesInput)).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("FAKE_CODEX_FAIL", "You've hit your usage limit");
    await expect(runTask("phrases", phrasesInput)).rejects.toMatchObject({ status: 429 });
    vi.stubEnv("FAKE_CODEX_FAIL", "boom");
    await expect(runTask("phrases", phrasesInput)).rejects.toThrow(/codex writing failed: [\s\S]*boom/);
  });

  it("finds the JSON object in a reply", () => {
    expect(extractJson('```json\n{"a":{"b":1}}\n```')).toEqual({ a: { b: 1 } });
    expect(() => extractJson("no json here")).toThrow();
  });
});
