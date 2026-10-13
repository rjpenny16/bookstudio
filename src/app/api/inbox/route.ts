import { NextResponse } from "next/server";
import { readInbox } from "@/lib/inbox/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ideas sent from the phone, newest last. */
export async function GET() {
  const s = await readInbox();
  return NextResponse.json({ items: s.items });
}
