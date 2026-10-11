import { NextResponse } from "next/server";
import { AiError, providerStatus, runTask } from "@/lib/ai/providers";
import { TASKS, type TaskName } from "@/lib/ai/tasks";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json(providerStatus());
}

export async function POST(req: Request) {
  let body: { task?: string; input?: unknown; images?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const task = body.task as TaskName;
  if (!task || !(task in TASKS)) return NextResponse.json({ error: `Unknown task "${body.task}"` }, { status: 400 });
  try {
    return NextResponse.json(await runTask(task, body.input, body.images));
  } catch (err) {
    if (err instanceof AiError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("AI task failed", err);
    return NextResponse.json({ error: "AI task failed unexpectedly" }, { status: 500 });
  }
}
