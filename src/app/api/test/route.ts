import { NextResponse } from "next/server";
import { capabilities, testConnection, type Capability } from "@/lib/ai/connection";

export const runtime = "nodejs";
export const maxDuration = 60;

const TARGETS: Capability[] = ["text", "vision", "images"];

export async function GET() {
  return NextResponse.json(capabilities());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { target?: string };
  const target = body.target as Capability;
  if (!TARGETS.includes(target)) return NextResponse.json({ error: `target must be one of ${TARGETS.join(", ")}` }, { status: 400 });
  return NextResponse.json(await testConnection(target));
}
