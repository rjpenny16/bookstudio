import type { BookType } from "@/lib/schema/project";
import { MAX_PAGES } from "./blueprint";
import { ART_CANDIDATES } from "./constants";
import { BATCH_SIZE } from "./content";

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
  // brief, blueprint, listing, listing critique, cover design pick, visual review;
  // plus a second visual review when the first sends the cover back for one redesign.
  let low = 6;
  let high = 7;
  let tokLow = 2_500 + 3_000 + 4_000 + 5_000 + 5_000 + 9_000;
  let tokHigh = 6_000 + 8_000 + 9_000 + 12_000 + 10_000 + 20_000 * 2;
  // Section content: 1-6 sections; sudoku/maze/number search need none, so puzzle books often need fewer.
  const sections: [number, number] = PUZZLES_WITHOUT_TEXT.includes(i.bookType) ? [0, 5] : i.bookType === "notebook" || i.bookType === "log-book" ? [0, 2] : [1, 5];
  // Content is written in batches of 30 items, so the longest book (300 pages) takes up to 10 calls across its sections.
  const batches = Math.max(sections[1], Math.ceil(MAX_PAGES / BATCH_SIZE));
  low += sections[0];
  // Each section may also need two top-up rounds, a review and one rewrite of its weak items.
  high += sections[1] ? batches + sections[1] * 4 : 0;
  tokLow += sections[0] * 4_000;
  tokHigh += sections[1] ? batches * 10_000 + sections[1] * 4 * 12_000 : 0;
  let visionCalls = 2;
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
