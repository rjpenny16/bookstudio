import { NextResponse } from "next/server";
import { claimNext } from "@/lib/inbox/state";
import { mutateInbox, notifyInboxChange } from "@/lib/inbox/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A BookStudio tab asks for the next idea to build; null when nothing is waiting. */
export async function POST() {
  const item = await mutateInbox((s) => {
    const { state, item } = claimNext(s, new Date());
    return { state, result: item };
  });
  if (item) notifyInboxChange(item);
  return NextResponse.json({ item });
}
