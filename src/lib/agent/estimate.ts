import type { BookType } from "@/lib/schema/project";
import { ART_CANDIDATES } from "./constants";

/**
 * A rough, honest estimate of what one autopilot run asks of the providers,
 * shown before the run starts. Token counts are ranges because the model
 * decides how much to think and how many sections need content; prices are
 * left to the provider's own pricing page.
 */

export interface RunEstimate {
  /** Text model calls (brief, plan, content, listing, reviews, art direction). */
  modelCalls: [number, number];
  /** Input + output tokens across those calls. */
  tokens: [number, number];
  /** Paid image generations. */
  images: number;
  /** Calls that send images to a vision model. */
  visionCalls: number;
  offline: boolean;
}

export interface EstimateInput {
  bookType: BookType;
  provider: "anthropic" | "ollama" | "offline";
  coverArt: boolean;
}

const PUZZLES_WITHOUT_TEXT = ["puzzle"];

export function estimateRun(i: EstimateInput): RunEstimate {
  if (i.provider === "offline") return { modelCalls: [0, 0], tokens: [0, 0], images: 0, visionCalls: 0, offline: true };
  // brief, blueprint, listing, listing critique, visual review
  let low = 5;
  let high = 5;
  let tokLow = 2_500 + 3_000 + 4_000 + 5_000 + 9_000;
  let tokHigh = 6_000 + 8_000 + 9_000 + 12_000 + 20_000;
  // Section content: 1-6 sections; sudoku/maze/number search need none, so puzzle books often need fewer.
  const sections: [number, number] = PUZZLES_WITHOUT_TEXT.includes(i.bookType) ? [0, 5] : i.bookType === "notebook" || i.bookType === "log-book" ? [0, 2] : [1, 5];
  low += sections[0];
  high += sections[1] * 2; // plus up to one top-up round each
  tokLow += sections[0] * 4_000;
  tokHigh += sections[1] * 2 * 14_000;
  let visionCalls = 1;
  let images = 0;
  if (i.coverArt) {
    // art direction + the vision pick
    low += 2;
    high += 2;
    tokLow += 2_500 + 6_000;
    tokHigh += 6_000 + 14_000;
    visionCalls++;
    images = ART_CANDIDATES;
  }
  return { modelCalls: [low, high], tokens: [round(tokLow), round(tokHigh)], images, visionCalls, offline: false };
}

const round = (n: number) => Math.round(n / 1000) * 1000;

export const formatTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
