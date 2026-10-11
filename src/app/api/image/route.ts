import { NextResponse } from "next/server";
import { z } from "zod";
import { ImageError, imageProvider, imageStatus } from "@/lib/ai/images";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  prompt: z.string().min(10).max(8000),
  widthIn: z.number().min(1).max(30),
  heightIn: z.number().min(1).max(30),
});

export async function GET() {
  return NextResponse.json(imageStatus());
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: `Invalid image request: ${parsed.error.issues[0]?.message}` }, { status: 400 });
  try {
    return NextResponse.json(await imageProvider().generate(parsed.data, req.signal));
  } catch (err) {
    if (err instanceof ImageError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Image generation failed", err);
    return NextResponse.json({ error: "Image generation failed unexpectedly" }, { status: 500 });
  }
}
