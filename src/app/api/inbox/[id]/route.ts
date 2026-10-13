import { NextResponse } from "next/server";
import { removeItem, updateItem, type InboxItem, type InboxResult } from "@/lib/inbox/state";
import { mutateInbox, notifyInboxChange } from "@/lib/inbox/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body =
  | { action: "heartbeat" }
  | { action: "ready"; result: InboxResult; coverPng?: string }
  | { action: "failed"; error: string }
  | { action: "retry" };

const isResult = (r: unknown): r is InboxResult => {
  const x = r as InboxResult;
  return Boolean(x && typeof x.projectId === "string" && typeof x.title === "string" && typeof x.pages === "number" && x.preflight && typeof x.preflight.passed === "number");
};

/** The building tab reports progress, the result or a failure; the Inbox page retries. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const now = new Date();
  let patch: Parameters<typeof updateItem>[3];
  if (body.action === "heartbeat") patch = { heartbeatAt: now.toISOString() };
  else if (body.action === "ready" && isResult(body.result)) patch = { status: "ready", result: body.result, error: undefined };
  else if (body.action === "failed") patch = { status: "failed", error: String(body.error || "Build failed").slice(0, 300) };
  else if (body.action === "retry") patch = { status: "queued", error: undefined, result: undefined };
  else return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const item = await mutateInbox<InboxItem | null>((s) => {
    const { state, item } = updateItem(s, id, now, patch);
    return { state, result: item };
  });
  if (!item) return NextResponse.json({ error: "No such idea" }, { status: 404 });
  if (body.action !== "heartbeat" && body.action !== "retry") {
    const png = body.action === "ready" && typeof body.coverPng === "string" ? Buffer.from(body.coverPng, "base64") : undefined;
    notifyInboxChange(item, { coverPng: png && png.length < 8_000_000 ? png : undefined });
  }
  return NextResponse.json({ item });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await mutateInbox((s) => ({ state: removeItem(s, id), result: null }));
  return NextResponse.json({ ok: true });
}
