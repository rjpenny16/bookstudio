import type { Element, Project } from "@/lib/schema/project";

export interface AiUsage {
  text: boolean;
  images: boolean;
  textSources: string[];
  imageSources: string[];
}

/** Derive what KDP's AI-disclosure questions should say from artifact provenance. */
export function aiUsage(project: Project): AiUsage {
  const textSources = new Set<string>();
  const imageSources = new Set<string>();
  const scan = (els: Element[], where: string) => {
    for (const el of els) {
      if (el.provenance?.origin !== "ai-generated") continue;
      if (el.type === "image") imageSources.add(where);
      else textSources.add(where);
    }
  };
  project.interior.pages.forEach((p, i) => scan(p.elements, `interior p.${i + 1}`));
  scan(project.cover.elements, "cover");
  for (const a of project.assets) if (a.origin === "ai-generated") imageSources.add(`asset ${a.name}`);
  for (const run of project.modelRuns) for (const o of run.outputs) if (o.startsWith("listing.")) textSources.add(o);
  // Collapse the per-page entries for readability.
  const pagesWithAi = [...textSources].filter((s) => s.startsWith("interior")).length;
  const text = [...textSources].filter((s) => !s.startsWith("interior"));
  if (pagesWithAi) text.unshift(`${pagesWithAi} interior page(s)`);
  return { text: textSources.size > 0, images: imageSources.size > 0, textSources: text, imageSources: [...imageSources] };
}
