import { NextResponse } from "next/server";
import { botStatus, sendTest } from "@/lib/inbox/discord";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the phone inbox's Discord bot is set up and connected. */
export async function GET() {
  return NextResponse.json(botStatus());
}

/** Settings → Test: posts a line in the ideas channel. */
export async function POST() {
  try {
    await sendTest();
    return NextResponse.json({ ok: true, ...botStatus() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err), ...botStatus() }, { status: 502 });
  }
}
