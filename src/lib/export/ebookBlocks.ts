import type { GeneratorConfig } from "@/lib/generators/pages";
import type { Project } from "@/lib/schema/project";

/**
 * A text (reflowable) eBook as a list of blocks, from the book's interior sections in
 * page order. Prose becomes real text; puzzles and other pages that can't reflow become
 * pictures of their pages; writing space is left out, since nobody can write on a Kindle.
 * Pure (no browser APIs): image blocks name page indices that the caller renders.
 */
export type EbookBlock =
  | { type: "title"; title: string; subtitle: string; author: string }
  | { type: "chapter"; kicker: string; title: string; paragraphs: string[] }
  | { type: "text"; title: string; paragraphs: string[] }
  | { type: "heading"; kicker: string; title: string; subtitle: string }
  | { type: "images"; label: string; pageIndices: number[] };

export interface EbookPlan {
  blocks: EbookBlock[];
  /** Labels of sections left out (writing space, the printed contents). */
  omitted: string[];
}

type Kind = GeneratorConfig["kind"];

/** Pages for writing or filling in, which a Kindle can't offer. The printed contents is replaced by the Kindle's own. */
const LEFT_OUT = new Set<Kind>(["lined", "dot-grid", "graph", "handwriting", "music", "gratitude", "daily-planner", "habit-tracker", "log", "monthly-calendar", "weekly-spread", "belongs-to", "blank", "table-of-contents"]);

/** Sections that are prose. */
const TEXT_KINDS = new Set<Kind>(["story", "text-page", "title-page", "section-divider", "journal-prompts"]);

/** Paragraphs from text with blank lines between them; single line breaks inside a paragraph become spaces. */
export const paragraphs = (body: string) =>
  body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

function textBlock(cfg: GeneratorConfig): EbookBlock | null {
  switch (cfg.kind) {
    case "story":
      return { type: "chapter", kicker: cfg.kicker ?? "", title: cfg.title, paragraphs: paragraphs(cfg.body) };
    case "text-page":
      return { type: "text", title: cfg.title, paragraphs: paragraphs(cfg.body) };
    case "title-page":
      return { type: "title", title: cfg.title, subtitle: cfg.subtitle, author: cfg.author };
    case "section-divider":
      return { type: "heading", kicker: cfg.kicker ?? "", title: cfg.title, subtitle: cfg.subtitle };
    case "journal-prompts":
      return { type: "text", title: "", paragraphs: cfg.prompts.map((p) => p.trim()).filter(Boolean) };
    default:
      return null;
  }
}

/** Walk the pages in order, one block per run of pages from the same section. */
export function sectionsToBlocks(project: Pick<Project, "interior">): EbookPlan {
  const sections = new Map(project.interior.sections.map((s) => [s.id, s]));
  const blocks: EbookBlock[] = [];
  const omitted: string[] = [];
  const pages = project.interior.pages;
  for (let i = 0; i < pages.length; ) {
    const sid = pages[i].sectionId;
    let j = i + 1;
    while (j < pages.length && pages[j].sectionId === sid) j++;
    const section = sid ? sections.get(sid) : undefined;
    const kind = section?.config.kind;
    const indices = Array.from({ length: j - i }, (_, k) => i + k);
    if (section && kind && LEFT_OUT.has(kind)) omitted.push(section.label);
    else if (section && kind && TEXT_KINDS.has(kind)) {
      const b = textBlock(section.config);
      if (b) blocks.push(b);
    } else blocks.push({ type: "images", label: section?.label ?? "Pages", pageIndices: indices });
    i = j;
  }
  return { blocks, omitted };
}

/** Words of prose in the book (story chapters and text pages), to choose a text eBook by default. */
export function storyWords(project: Pick<Project, "interior">): number {
  let n = 0;
  for (const s of project.interior.sections) {
    if (s.config.kind === "story" || s.config.kind === "text-page") n += s.config.body.split(/\s+/).filter(Boolean).length;
  }
  return n;
}

/** Books with a story read better as a text eBook; everything else keeps its print layout. */
export function ebookLayoutDefault(project: Pick<Project, "interior">): "fixed" | "text" {
  return project.interior.sections.some((s) => s.config.kind === "story") || storyWords(project) > 1500 ? "text" : "fixed";
}

/** The layout the eBook is built in: the author's choice, else the default for the book. */
export function ebookLayoutOf(project: Pick<Project, "interior" | "formats">): "fixed" | "text" {
  return project.formats?.find((f) => f.kind === "ebook")?.ebookLayout ?? ebookLayoutDefault(project);
}
