import { EBOOK_MIN_PRICE_BY_SIZE, EBOOK_ROYALTY_US as R } from "./rules-ebook";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type RoyaltyPlan = "70" | "35";

/** Lowest list price KDP allows at 35% for a file this size. */
export const ebookMinPrice = (fileMb: number) => EBOOK_MIN_PRICE_BY_SIZE.find((b) => fileMb <= b.maxMb)!.minUsd;

export const deliveryFeeUsd = (fileMb: number) => Math.max(R.deliveryMinUsd, r2(fileMb * R.deliveryPerMbUsd));

export interface EbookRoyalty {
  seventy: { eligible: boolean; deliveryUsd: number; royaltyUsd: number };
  thirtyFive: { eligible: boolean; minPriceUsd: number; royaltyUsd: number };
  /** The plan that pays more at this price (35% when 70% is not allowed). */
  best: RoyaltyPlan;
}

/** Royalty per sale on Amazon.com at both rates, for a list price and file size. */
export function ebookRoyalty(priceUsd: number, fileMb: number): EbookRoyalty {
  const deliveryUsd = deliveryFeeUsd(fileMb);
  const seventyEligible = priceUsd >= R.highMinUsd && priceUsd <= R.highMaxUsd;
  const minPriceUsd = ebookMinPrice(fileMb);
  const seventy = { eligible: seventyEligible, deliveryUsd, royaltyUsd: r2(priceUsd * R.highRate - deliveryUsd) };
  const thirtyFive = { eligible: priceUsd >= minPriceUsd && priceUsd <= R.lowMaxUsd, minPriceUsd, royaltyUsd: r2(priceUsd * R.lowRate) };
  return { seventy, thirtyFive, best: seventy.eligible && seventy.royaltyUsd > thirtyFive.royaltyUsd ? "70" : "35" };
}

export const bytesToMb = (bytes: number) => bytes / (1024 * 1024);
