import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { codexPath, runCodex } from "./codex";
import { codexLimits, DEFAULT_LIMITS, type ProviderLimits } from "./limits";
import { offlineTask } from "./offline";
import { SYSTEM_PROMPT, TASK_EFFORT, TASKS, taskPrompt, VISION_TASKS, type TaskInput, type TaskName, type TaskOutput } from "./tasks";

export type ProviderName = "anthropic" | "ollama" | "codex" | "offline";

export interface ProviderStatus {
  provider: ProviderName;
  model: string;
  configured: boolean;
  detail: string;
  /** How the content writer should batch and pace calls to this provider. */
  limits: ProviderLimits;
}

export interface TaskResult<T extends TaskName> {
  output: TaskOutput<T>;
  meta: { provider: ProviderName; model: string; task: T; promptHash: string; /** Wall-clock time of the call. */ ms: number };
}

/** An image sent alongside a vision task's prompt (base64, no data: prefix). */
export const TaskImage = z.object({
  label: z.string().max(80),
  mediaType: z.enum(["image/png", "image/jpeg"]),
  data: z.string().max(5_000_000),
});
export type TaskImage = z.infer<typeof TaskImage>;
export const TaskImages = z.array(TaskImage).max(12);

export class AiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

const hasAnthropicCreds = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export function providerStatus(): ProviderStatus {
  return { ...providerChoice(), limits: (process.env.AI_PROVIDER ?? "").toLowerCase() === "codex" ? codexLimits(process.env) : DEFAULT_LIMITS };
}

function providerChoice(): Omit<ProviderStatus, "limits"> {
  const requested = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (requested === "codex") {
    return { provider: "codex", model: codexTextModel(), configured: true, detail: "Writing through the codex CLI on your ChatGPT subscription (no API key)" };
  }
  if (requested === "ollama") {
    const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
    return { provider: "ollama", model, configured: true, detail: `Ollama at ${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}` };
  }
  if (requested !== "offline" && hasAnthropicCreds()) {
    const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
    return { provider: "anthropic", model, configured: true, detail: "Claude via the Anthropic API" };
  }
  return {
    provider: "offline",
    model: "heuristic-v1",
    configured: requested === "offline",
    detail: requested === "anthropic" || requested === "" ? "No ANTHROPIC_API_KEY set; using built-in offline heuristics" : "Built-in offline heuristics",
  };
}

async function runAnthropic<T extends TaskName>(task: T, prompt: string, model: string, images: TaskImage[]): Promise<TaskOutput<T>> {
  const client = new Anthropic();
  const schema = TASKS[task].output as unknown as z.ZodType<TaskOutput<T>>;
  // Each image is preceded by its label so the model can name it in findings.
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...images.flatMap((img): Anthropic.Beta.BetaContentBlockParam[] => [
      { type: "text", text: `Image: ${img.label}` },
      { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
    ]),
    { type: "text", text: prompt },
  ];
  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: images.length ? content : prompt }],
      output_config: { effort: TASK_EFFORT[task], format: betaZodOutputFormat(schema) },
    });
    if (response.stop_reason === "refusal") throw new AiError(`The model declined this request${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}.`, 422);
    if (response.stop_reason === "max_tokens") throw new AiError("The model ran out of output tokens; try a smaller request.");
    if (!response.parsed_output) throw new AiError("The model returned output that did not match the schema.");
    return response.parsed_output;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("Anthropic API key was rejected.", 401);
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by the Anthropic API; try again shortly.", 429);
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }
}

async function runOllama<T extends TaskName>(task: T, prompt: string, model: string, images: TaskImage[]): Promise<TaskOutput<T>> {
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const schema = TASKS[task].output;
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: z.toJSONSchema(schema),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt, ...(images.length ? { images: images.map((i) => i.data) } : {}) },
      ],
    }),
  }).catch((e: unknown) => {
    throw new AiError(`Could not reach Ollama at ${base}: ${e instanceof Error ? e.message : e}`);
  });
  if (!res.ok) throw new AiError(`Ollama returned ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { message?: { content?: string } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.message?.content ?? "");
  } catch {
    throw new AiError("The local model did not return valid JSON.");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new AiError(`The local model's output did not match the schema: ${result.error.issues[0]?.message}`);
  return result.data as TaskOutput<T>;
}

/** codex picks its default model unless CODEX_TEXT_MODEL names one; the label is for provenance. */
const codexTextModel = () => process.env.CODEX_TEXT_MODEL?.trim() || "chatgpt";
/**
 * How long one codex writing call may run. The mystery tasks plan a whole
 * case or write a full chapter at high effort, which routinely runs past the
 * 8 minutes the shorter tasks get. CODEX_TEXT_TIMEOUT_MINUTES overrides both.
 */
export function codexTextTimeoutMs(task: TaskName): number {
  const env = Number(process.env.CODEX_TEXT_TIMEOUT_MINUTES);
  if (Number.isFinite(env) && env > 0) return env * 60_000;
  return task.startsWith("mystery-") ? 25 * 60_000 : 8 * 60_000;
}

/** The JSON object in a reply, without code fences or a sentence around it. */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new SyntaxError("no JSON object");
  return JSON.parse(reply.slice(start, end + 1));
}

/**
 * The strict JSON Schema codex's --output-schema expects: every object lists
 * all its properties as required and allows no others, and keywords strict
 * mode doesn't take (zod's safe-integer bounds, $schema) are left out.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === "$schema" || k === "minimum" || k === "maximum") continue;
    // Property names are data, not schema keywords.
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([name, sub]) => [name, strictSchema(sub)])) : strictSchema(v);
  }
  if (out.type === "object" && out.properties) {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

/** Set once a codex rejects --output-schema or --ephemeral (an older CLI); later calls use the prompt-only path. */
let codexLegacy = false;
const unknownFlag = (e: unknown) => e instanceof AiError && /unexpected argument|unrecognized (option|argument)|unknown (option|argument)/i.test(e.message);

/**
 * Writing through the codex CLI and the user's ChatGPT subscription. codex
 * exec runs read-only and ephemeral in an empty temp dir. The reply's shape is
 * enforced by --output-schema (on older CLIs the schema goes in the prompt),
 * and it is validated here, with one retry that names what was wrong.
 */
async function runCodexText<T extends TaskName>(task: T, prompt: string, images: TaskImage[], signal?: AbortSignal): Promise<TaskOutput<T>> {
  const schema = TASKS[task].output;
  const dir = await mkdtemp(path.join(tmpdir(), "bookstudio-text-"));
  try {
    const files = await Promise.all(
      images.map(async (img, i) => {
        const file = path.join(dir, `image-${i + 1}.${img.mediaType === "image/png" ? "png" : "jpg"}`);
        await writeFile(file, Buffer.from(img.data, "base64"));
        return file;
      }),
    );
    const jsonSchema = z.toJSONSchema(schema);
    const schemaFile = path.join(dir, "schema.json");
    await writeFile(schemaFile, JSON.stringify(strictSchema(jsonSchema)));
    const labels = images.length ? `The attached images are, in order:\n${images.map((img, i) => `${i + 1}. ${img.label}`).join("\n")}\n\n` : "";
    const head = [SYSTEM_PROMPT, "Answer from your own knowledge. Do not run commands, read or write files, or browse; there is nothing in your working directory.", `${labels}${prompt}`];
    // With --output-schema the shape is enforced, so the prompt needn't carry the schema.
    const base = (legacy: boolean) =>
      [...head, legacy ? `Reply with only one JSON object that matches this JSON Schema: no prose, no code fences.\n${JSON.stringify(jsonSchema)}` : "Reply with only the JSON object."].join("\n\n");
    const out = path.join(dir, "reply.txt");
    const model = process.env.CODEX_TEXT_MODEL?.trim();
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const legacy = codexLegacy;
      const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--color", "never", "-C", codexPath(dir), "-o", codexPath(out), "-c", `model_reasoning_effort="${TASK_EFFORT[task]}"`];
      if (!legacy) args.push("--ephemeral", "--output-schema", codexPath(schemaFile));
      if (model) args.push("-m", model);
      for (const f of files) args.push("--image", codexPath(f));
      // The prompt goes on stdin ("-"), after "--" so a variadic --image can't swallow it.
      const stdin = problem ? `${base(legacy)}\n\nYour previous reply was rejected (${problem}). Reply again with only the JSON object.` : base(legacy);
      await rm(out, { force: true });
      try {
        await runCodex({ args: ["-c", 'exec codex "$@"', "codex", ...args, "--", "-"], dir, timeoutMs: codexTextTimeoutMs(task), signal, stdin, what: "writing", fail: (msg, status) => new AiError(msg, status) });
      } catch (e) {
        // An older codex without these flags: remember, and run this attempt again the old way.
        if (!legacy && unknownFlag(e)) {
          codexLegacy = true;
          attempt--;
          continue;
        }
        throw e;
      }
      const reply = await readFile(out, "utf8").catch(() => "");
      let parsed: unknown;
      try {
        parsed = extractJson(reply);
      } catch {
        problem = reply.trim() ? "it was not valid JSON" : "it was empty";
        continue;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data as TaskOutput<T>;
      const issue = result.error.issues[0];
      problem = `${issue?.path.join(".") || "output"}: ${issue?.message}`;
    }
    throw new AiError(`codex's reply did not match the schema (${problem}).`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** For tests: forget that a codex without --output-schema was seen. */
export function resetCodexLegacy() {
  codexLegacy = false;
}

/**
 * Run one task. `offline` forces the built-in heuristics whatever the
 * provider: the content writer uses it to fill a section the model left short.
 */
export async function runTask<T extends TaskName>(task: T, rawInput: unknown, rawImages: unknown = [], signal?: AbortSignal, offline = false): Promise<TaskResult<T>> {
  const inputParse = TASKS[task].input.safeParse(rawInput);
  if (!inputParse.success) throw new AiError(`Invalid input for ${task}: ${inputParse.error.issues[0]?.message}`, 400);
  const imagesParse = TaskImages.safeParse(rawImages ?? []);
  if (!imagesParse.success) throw new AiError(`Invalid images: ${imagesParse.error.issues[0]?.message}`, 400);
  const images = VISION_TASKS.includes(task) ? imagesParse.data : [];
  if (VISION_TASKS.includes(task) && !images.length) throw new AiError(`${task} needs at least one image.`, 400);
  const input = inputParse.data as TaskInput<T>;
  const prompt = taskPrompt(task, input);
  const status = offline ? { provider: "offline" as const, model: "heuristic-v1" } : providerStatus();
  const started = Date.now();
  const hash = createHash("sha256").update(SYSTEM_PROMPT + prompt);
  for (const img of images) hash.update(img.data);
  const promptHash = `sha256:${hash.digest("hex")}`;
  let output: TaskOutput<T>;
  if (status.provider === "anthropic") output = await runAnthropic(task, prompt, status.model, images);
  else if (status.provider === "ollama") output = await runOllama(task, prompt, status.model, images);
  else if (status.provider === "codex") output = await runCodexText(task, prompt, images, signal);
  else output = offlineTask(task, input);
  return { output, meta: { provider: status.provider, model: status.model, task, promptHash, ms: Date.now() - started } };
}
