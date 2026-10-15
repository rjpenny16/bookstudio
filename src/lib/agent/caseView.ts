import type { InteriorSection, Project } from "@/lib/schema/project";

/**
 * How Review & Publish groups a book's pages for flipping through. Most
 * books show one group per section. A murder mystery with its case plan
 * shows one group per chapter: the chapter's story and then the puzzles
 * that hide its clues (and the case board or final deduction that follows
 * it), so a reader's view of the book matches how it reads.
 */

export interface ViewGroup {
  id: string;
  label: string;
  role: InteriorSection["role"];
  sectionIds: string[];
  /** The chapter (1-based) for a mystery chapter's group. */
  chapter?: number;
}

/** Sections shown in the flip-through: everything except section dividers, which travel with their section. */
export function viewSections(project: Project): InteriorSection[] {
  return project.interior.sections.filter((s) => s.config.kind !== "section-divider" && project.interior.pages.some((p) => p.sectionId === s.id));
}

export function viewGroups(project: Project): ViewGroup[] {
  const single = (s: InteriorSection): ViewGroup => ({ id: s.id, label: s.label, role: s.role, sectionIds: [s.id] });
  const sections = viewSections(project);
  if (!project.mystery) return sections.map(single);
  const out: ViewGroup[] = [];
  let chapter: ViewGroup | null = null;
  for (const s of sections) {
    const m = s.config.kind === "story" ? s.label.match(/^Chapter (\d+):/) : null;
    if (m) {
      chapter = { ...single(s), chapter: Number(m[1]) };
      out.push(chapter);
    } else if (chapter && s.role === "body") chapter.sectionIds.push(s.id);
    else {
      chapter = null;
      out.push(single(s));
    }
  }
  return out;
}

/** Book page indexes (0-based) of a group, in reading order. */
export function groupPages(project: Project, group: ViewGroup): number[] {
  const ids = new Set(group.sectionIds);
  const out: number[] = [];
  project.interior.pages.forEach((p, i) => p.sectionId && ids.has(p.sectionId) && out.push(i));
  return out;
}
