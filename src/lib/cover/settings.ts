import type { Project } from "@/lib/schema/project";
import { PALETTES, suggestTemplate } from "./templates";

/** Cover settings to keep when rebuilding: template, palette, back blurb, and which back-cover extras are on. */
export function coverSettings(project: Project) {
  const els = project.cover.elements;
  // The back copy is laid out as a hook line plus the blurb; rebuild it as one text.
  const backText = els.flatMap((e) => (e.type === "text" && (e.name === "Back hook" || e.name === "Back blurb") ? [e.text] : [])).join(" ");
  return {
    templateId: project.cover.templateId ?? suggestTemplate(project.bookType),
    palette: project.cover.palette ?? PALETTES.find((p) => p.id === project.cover.paletteId) ?? PALETTES[0],
    backText,
    inside: els.some((e) => e.name === "Inside heading"),
    thumbs: els.some((e) => e.name === "Back page thumbnail"),
    aiListing: project.modelRuns.some((r) => r.outputs.some((o) => o.startsWith("listing."))),
  };
}
