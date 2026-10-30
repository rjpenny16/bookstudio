import { NextResponse } from "next/server";
import { keywordVolumes, marketSnapshot, MarketError, marketStatus, rankHistories, testMarket } from "@/lib/market/server";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET() {
  return NextResponse.json(marketStatus());
}

type Body =
  | { action: "snapshot"; keyword: string }
  | { action: "history"; asins: string[] }
  | { action: "volumes"; keywords: string[] }
  | { action: "test"; target: "products" | "keywords" };

const ASIN = /^[A-Z0-9]{10}$/;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  try {
    switch (body.action) {
      case "snapshot": {
        const keyword = String(body.keyword ?? "").trim().slice(0, 120);
        if (!keyword) return NextResponse.json({ error: "keyword is required" }, { status: 400 });
        return NextResponse.json(await marketSnapshot(keyword, req.signal));
      }
      case "history": {
        const asins = (Array.isArray(body.asins) ? body.asins : []).map((a) => String(a).trim().toUpperCase()).filter((a) => ASIN.test(a));
        if (!asins.length) return NextResponse.json({ error: "asins must list 10-character ASINs" }, { status: 400 });
        return NextResponse.json(await rankHistories(asins, req.signal));
      }
      case "volumes": {
        const keywords = (Array.isArray(body.keywords) ? body.keywords : []).map((k) => String(k).trim()).filter(Boolean);
        if (!keywords.length) return NextResponse.json({ error: "keywords is required" }, { status: 400 });
        return NextResponse.json(await keywordVolumes(keywords, req.signal));
      }
      case "test":
        if (body.target !== "products" && body.target !== "keywords") return NextResponse.json({ error: "target must be products or keywords" }, { status: 400 });
        return NextResponse.json(await testMarket(body.target));
      default:
        return NextResponse.json({ error: "action must be snapshot, history, volumes or test" }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof MarketError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Market request failed", err);
    return NextResponse.json({ error: "Market request failed unexpectedly" }, { status: 500 });
  }
}
