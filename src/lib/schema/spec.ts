import { findTrim } from "@/lib/kdp/geometry";
import { RULES_VERSION } from "@/lib/kdp/rules";
import type { PrintSpec } from "./project";

/** A KDP paperback print spec for a trim (the fallback trim when the id is unknown). */
export function paperbackSpec(trimId: string, opts: Partial<Pick<PrintSpec, "bleed" | "paper" | "ink" | "coverFinish">> = {}, fallbackTrimId = "6x9"): PrintSpec {
  const trim = findTrim(trimId) ?? findTrim(fallbackTrimId)!;
  return {
    marketplace: "amazon-kdp",
    binding: "paperback",
    trimId: trim.id,
    widthIn: trim.widthIn,
    heightIn: trim.heightIn,
    bleed: opts.bleed ?? false,
    paper: opts.paper ?? "white",
    ink: opts.ink ?? "black",
    coverFinish: opts.coverFinish ?? "matte",
    rulesVersion: RULES_VERSION,
  };
}
