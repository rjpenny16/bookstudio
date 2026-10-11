"use client";

import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import type { Project } from "@/lib/schema/project";
import { PageThumb } from "@/components/workspace/PageThumb";

/** Pages shown per section while the book is built: enough to see what each part looks like. */
const PER_SECTION = 2;

/** The draft as autopilot builds it: page thumbnails once the interior is laid out, then the cover. */
export function LiveBuild({ project, hasCover }: { project: Project | null; hasCover: boolean }) {
  if (!project) return <div className="empty">Pages appear here as soon as the interior is laid out.</div>;
  const n = project.interior.pages.length;
  const g = interiorGeometry(project.spec, n);
  const cg = coverGeometry(project.spec, n);
  const shown = project.interior.sections
    .filter((s) => s.config.kind !== "section-divider")
    .flatMap((s) => {
      const idx: number[] = [];
      project.interior.pages.forEach((p, i) => p.sectionId === s.id && idx.length < PER_SECTION && idx.push(i));
      return idx.map((i) => ({ i, label: s.label }));
    });
  return (
    <div className="live-build" aria-label="Live build">
      <div className="live-cover">
        {hasCover ? (
          <PageThumb elements={project.cover.elements} widthPt={cg.trimW} heightPt={cg.trimH} originX={-cg.front.x} originY={-cg.front.y} background={project.cover.background} assets={project.assets} px={180} alt="Front cover (live)" />
        ) : (
          <div className="page-thumb-ph" style={{ ["--ratio" as string]: `${cg.trimW / cg.trimH}` }} aria-label="Cover not designed yet" />
        )}
        <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
          {hasCover ? project.metadata.title : "Cover comes after the listing"}
        </p>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {n} pages in {project.interior.sections.length} parts
        </span>
        <div className="live-pages" role="list" aria-label="Pages so far">
          {shown.map(({ i, label }) => (
            <figure key={project.interior.pages[i].id} role="listitem">
              <PageThumb elements={project.interior.pages[i].elements} widthPt={g.trimW} heightPt={g.trimH} assets={project.assets} px={84} alt={`Page ${i + 1}`} />
              <figcaption title={label}>
                {i + 1} · {label}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
