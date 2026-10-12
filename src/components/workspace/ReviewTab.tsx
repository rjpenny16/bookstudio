"use client";

import { useEffect, useMemo, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { canRegenerate } from "@/lib/agent/regenerate";
import { coverSettings, regenerateCoverWithAi, regenerateListingWithAi, regenerateSectionWithAi, type Regenerated } from "@/lib/agent/regenerateClient";
import { isSavedTemplateId } from "@/lib/cover/library";
import { PALETTES, templateInfo } from "@/lib/cover/templates";
import { designCover } from "@/lib/cover/artClient";
import { variantPalette } from "@/lib/cover/variants";
import { CoverVariants } from "./CoverVariants";
import { downloadPackage } from "@/lib/export/client";
import { coverGeometry, interiorGeometry } from "@/lib/kdp/geometry";
import { LISTING } from "@/lib/kdp/rules";
import { validateListing } from "@/lib/metadata/validate";
import type { PreflightReport } from "@/lib/preflight";
import { applyFix } from "@/lib/preflight/fixes";
import { aiUsage } from "@/lib/preflight/aiUsage";
import { applyRevisedListing, qualityReport } from "@/lib/quality";
import { critiqueListing, reviewVisuals } from "@/lib/quality/review";
import { scorecard, type RowStatus } from "@/lib/quality/scorecard";
import type { AiDisclosureLevel, CoverVariant, InteriorSection, Project } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";
import { PageThumb } from "./PageThumb";
import type { TabId } from "./Workspace";

/**
 * Review & Publish: everything needed to go from an autopilot draft to an
 * upload package on one screen. The other tabs stay available for detailed
 * editing.
 */

const ICON: Record<RowStatus, string> = { pass: "✓", warn: "!", fail: "✕" };
type Busy = null | "cover" | "listing" | "reviews" | "export" | `section:${string}`;
type Note = { kind: "info" | "fail" | "pass"; text: string } | null;

function RegenerateBox({ what, placeholder, busy, disabled, onRun }: { what: string; placeholder: string; busy: boolean; disabled: boolean; onRun: (feedback: string) => Promise<void> }) {
  const [feedback, setFeedback] = useState("");
  return (
    <form
      className="regen"
      onSubmit={async (e) => {
        e.preventDefault();
        await onRun(feedback.trim());
        setFeedback("");
      }}
    >
      <label className="field" style={{ flex: 1 }}>
        <span className="sr-only">Feedback for the {what}</span>
        <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder={placeholder} aria-label={`Feedback for the ${what}`} />
      </label>
      <button className="btn btn-sm" type="submit" disabled={disabled}>
        {busy && <span className="spinner" />} Regenerate {what}
      </button>
    </form>
  );
}

function bookPages(project: Project, section: InteriorSection): number[] {
  const out: number[] = [];
  project.interior.pages.forEach((p, i) => p.sectionId === section.id && out.push(i));
  return out;
}

/** Sections shown in the flip-through: everything except section dividers, which travel with their section. */
function viewSections(project: Project): InteriorSection[] {
  return project.interior.sections.filter((s) => s.config.kind !== "section-divider" && project.interior.pages.some((p) => p.sectionId === s.id));
}

export function ReviewTab({ report, onGo }: { report: PreflightReport; onGo: (tab: TabId) => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const replace = useProjectStore((s) => s.replace);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<Note>(null);
  const [approved, setApproved] = useState(false);
  const [progress, setProgress] = useState<{ label: string; f: number } | null>(null);
  const sections = useMemo(() => viewSections(project), [project]);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [pageAt, setPageAt] = useState(0);
  const quality = useMemo(() => qualityReport(project), [project]);
  const card = useMemo(() => scorecard(project, report, quality), [project, report, quality]);
  const offline = status?.provider === "offline";

  useEffect(() => {
    aiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const n = project.interior.pages.length;
  const g = interiorGeometry(project.spec, n);
  const cg = coverGeometry(project.spec, n);
  const section = sections.find((s) => s.id === sectionId) ?? sections.find((s) => s.role === "body") ?? sections[0];
  const pages = section ? bookPages(project, section) : [];
  const at = Math.min(pageAt, Math.max(0, pages.length - 1));
  const current = project.interior.pages[pages[at]];
  const m = project.metadata;
  const v = validateListing(m, project.bookType);
  const usage = aiUsage(project);
  const listingReview = quality.reviews.listing;
  const candidates = project.coverArt?.candidates ?? [];
  const templateName = isSavedTemplateId(project.cover.templateId) ? "saved" : (templateInfo(project.cover.templateId)?.name ?? "custom");
  const paletteName = project.cover.palette?.name ?? PALETTES.find((p) => p.id === project.cover.paletteId)?.name;

  /** Run one action at a time; a regenerated project replaces the current one (undo brings the old one back). */
  const act = async (kind: NonNullable<Busy>, fn: (p: Project) => Promise<Regenerated>) => {
    setBusy(kind);
    setNote(null);
    try {
      const r = await fn(useProjectStore.getState().project!);
      replace({ ...r.project, updatedAt: new Date().toISOString() });
      setNote({ kind: "pass", text: `${r.summary} Undo brings back the previous version.` });
    } catch (e) {
      setNote({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const chooseCandidate = (id: string) =>
    act("cover", async (p) => {
      const c = p.coverArt!.candidates.find((x) => x.id === id)!;
      return { project: await designCover(p, { ...coverSettings(p), templateId: c.layout, candidateId: id }), summary: `"${c.name}" is on the cover.` };
    });

  const applyVariant = (v: CoverVariant) =>
    act("cover", async (p) => {
      const palette = variantPalette(v);
      return { project: await designCover(p, { ...coverSettings(p), templateId: v.templateId, palette }), summary: `The ${templateInfo(v.templateId)?.name ?? v.templateId} design with the ${palette.name} palette is on the cover.` };
    });

  const runReviews = () =>
    act("reviews", async (p) => {
      const listing = await critiqueListing(p);
      const visual = offline ? null : await reviewVisuals(p);
      const next = { ...p, reviews: { ...p.reviews, listing: listing.review, ...(visual ? { visual: visual.review } : {}) }, modelRuns: [...p.modelRuns, ...[listing.run, visual?.run].filter((r) => r !== null && r !== undefined)] };
      return { project: next, summary: visual ? `Listing ${listing.review.score}/10, cover & pages ${visual.review.score}/10.` : "Listing checked. The visual review needs a model that can see images." };
    });

  const fix = (ids: string[]) => {
    let next = useProjectStore.getState().project!;
    for (const id of ids) next = applyFix(next, id as Parameters<typeof applyFix>[1]);
    replace({ ...next, updatedAt: new Date().toISOString() });
    setNote({ kind: "pass", text: `Applied ${ids.length} fix${ids.length === 1 ? "" : "es"}. Undo is available.` });
  };

  const applyRevision = () => {
    if (!listingReview?.revised) return;
    const { metadata, changed } = applyRevisedListing(project, listingReview.revised);
    if (!changed.length) return setNote({ kind: "info", text: "The suggested listing matches yours, or would add listing errors, so nothing was changed." });
    update((d) => {
      d.metadata = metadata;
      const r = d.modelRuns.findLast((x) => x.task === "listing-critique");
      if (r) r.outputs.push(...changed.map((c) => `listing.${c}`).filter((o) => !r.outputs.includes(o)));
    });
    setNote({ kind: "pass", text: `Updated ${changed.join(", ")}. Regenerate the cover if the title changed.` });
  };

  const exportPackage = async () => {
    setBusy("export");
    setNote(null);
    setProgress({ label: "Building package", f: 0 });
    try {
      await downloadPackage(project, report.blocking > 0, (label, f) => setProgress({ label, f }));
    } catch (e) {
      setNote({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setProgress(null);
      setBusy(null);
    }
  };

  const setMeta = (fn: (d: Project["metadata"]) => void) => update((d) => void fn(d.metadata));
  const keywords = [...m.keywords, ...Array(Math.max(0, LISTING.maxKeywords - m.keywords.length)).fill("")].slice(0, LISTING.maxKeywords);
  const disclosure = (key: "text" | "images" | "translation", label: string, detected: boolean) => (
    <label className="field">
      <span>
        {label} {detected && <span className="badge badge-info">detected</span>}
      </span>
      <select
        value={m.aiDisclosure[key]}
        onChange={(e) =>
          setMeta((d) => {
            d.aiDisclosure[key] = e.target.value as AiDisclosureLevel;
            d.aiDisclosure.confirmed = false;
          })
        }
      >
        <option value="none">None</option>
        <option value="some">Some</option>
        <option value="most">Most or all</option>
      </select>
    </label>
  );

  return (
    <div className="split-aside review-screen">
      <div className="stack">
        {note && (
          <div className={`notice notice-${note.kind}`} role="status">
            {note.text}
          </div>
        )}

        <section className="card stack" aria-labelledby="review-cover">
          <div className="row-between">
            <h2 id="review-cover" style={{ margin: 0 }}>
              Cover
            </h2>
            <button className="btn btn-sm btn-ghost" onClick={() => onGo("cover")}>
              Edit in studio
            </button>
          </div>
          <div className="review-cover">
            <div className="review-cover-front">
              <PageThumb elements={project.cover.elements} widthPt={cg.trimW} heightPt={cg.trimH} originX={-cg.front.x} originY={-cg.front.y} background={project.cover.background} assets={project.assets} px={280} alt="Front cover" />
            </div>
            <div className="stack" style={{ gap: 8, minWidth: 0 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                {templateName} template{paletteName ? `, ${paletteName} palette` : ""}
              </span>
              {candidates.length > 0 && (
                <>
                  <strong style={{ fontSize: 13 }}>Cover art candidates</strong>
                  <div className="candidate-strip" role="list" aria-label="Cover candidates">
                    {candidates.map((c) => {
                      const on = c.id === project.coverArt?.chosenId && project.cover.templateId === c.layout;
                      return (
                        <div key={c.id} role="listitem" aria-label={c.name} className={`candidate${on ? " on" : ""}`}>
                          <img src={c.dataUrl} alt={`Cover art: ${c.name}`} />
                          <button className="btn btn-sm" disabled={on || busy !== null} onClick={() => chooseCandidate(c.id)}>
                            {on ? "On cover" : "Use"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {project.coverArt?.pickReason && <p className="field-hint" style={{ margin: 0 }}>Why this one: {project.coverArt.pickReason}</p>}
                </>
              )}
              <CoverVariants project={project} disabled={busy !== null} onUse={applyVariant} />
              <RegenerateBox what="cover" placeholder='e.g. "warmer colors", "more playful", "less busy"' busy={busy === "cover"} disabled={busy !== null} onRun={(f) => act("cover", (p) => regenerateCoverWithAi(p, f))} />
            </div>
          </div>
        </section>

        <section className="card stack" aria-labelledby="review-pages">
          <div className="row-between">
            <h2 id="review-pages" style={{ margin: 0 }}>
              Pages
            </h2>
            <span className="muted" style={{ fontSize: 13 }}>
              {n} pages · {project.spec.widthIn}&quot; × {project.spec.heightIn}&quot;
            </span>
          </div>
          <div className="chip-list" role="tablist" aria-label="Book sections">
            {sections.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={s.id === section?.id}
                className="chip"
                style={{ borderColor: s.id === section?.id ? "var(--accent)" : undefined }}
                onClick={() => {
                  setSectionId(s.id);
                  setPageAt(0);
                }}
              >
                {s.label} <span className="muted">{bookPages(project, s).length}</span>
              </button>
            ))}
          </div>
          {section && current && (
            <div className="flip" aria-label={`${section.label}, page ${at + 1} of ${pages.length}`}>
              <button className="btn btn-sm" aria-label="Previous page" disabled={at === 0} onClick={() => setPageAt(at - 1)}>
                ‹
              </button>
              <div className="flip-page">
                <PageThumb key={current.id} elements={current.elements} widthPt={g.trimW} heightPt={g.trimH} assets={project.assets} px={360} alt={`Book page ${pages[at] + 1}`} />
                <span className="muted" style={{ fontSize: 12 }}>
                  {section.label}: {at + 1} of {pages.length} · book page {pages[at] + 1}
                </span>
              </div>
              <button className="btn btn-sm" aria-label="Next page" disabled={at >= pages.length - 1} onClick={() => setPageAt(at + 1)}>
                ›
              </button>
            </div>
          )}
          {section && pages.length > 1 && (
            <div className="thumb-strip" aria-label={`${section.label} pages`}>
              {pages.slice(0, 40).map((pi, k) => (
                <button key={project.interior.pages[pi].id} className="page-thumb-btn" aria-current={k === at} onClick={() => setPageAt(k)}>
                  <PageThumb elements={project.interior.pages[pi].elements} widthPt={g.trimW} heightPt={g.trimH} assets={project.assets} px={72} alt={`Page ${pi + 1}`} />
                  <span>{pi + 1}</span>
                </button>
              ))}
              {pages.length > 40 && <span className="muted" style={{ alignSelf: "center", fontSize: 12 }}>+{pages.length - 40} more</span>}
            </div>
          )}
          {section && canRegenerate(section) && (
            <RegenerateBox
              key={section.id}
              what={`"${section.label}"`}
              placeholder={"difficulty" in section.config ? 'e.g. "harder puzzles", "more about birds"' : 'e.g. "shorter prompts", "more playful"'}
              busy={busy === `section:${section.id}`}
              disabled={busy !== null}
              onRun={(f) => act(`section:${section.id}`, (p) => regenerateSectionWithAi(p, section.id, f))}
            />
          )}
        </section>

        <section className="card stack" aria-labelledby="review-listing">
          <div className="row-between">
            <h2 id="review-listing" style={{ margin: 0 }}>
              Listing
            </h2>
            <button className="btn btn-sm btn-ghost" onClick={() => onGo("listing")}>
              All listing fields
            </button>
          </div>
          <label className="field">
            <span className="row-between">
              Title <span className={`counter${m.title.length + m.subtitle.length > LISTING.maxTitleSubtitleChars ? " over" : ""}`}>{m.title.length + m.subtitle.length}/{LISTING.maxTitleSubtitleChars}</span>
            </span>
            <input value={m.title} onChange={(e) => setMeta((d) => void (d.title = e.target.value))} />
          </label>
          <label className="field">
            Subtitle
            <input value={m.subtitle} onChange={(e) => setMeta((d) => void (d.subtitle = e.target.value))} />
          </label>
          <label className="field">
            <span className="row-between">
              Description <span className={`counter${m.description.length > LISTING.maxDescriptionChars ? " over" : ""}`}>{m.description.length}/{LISTING.maxDescriptionChars}</span>
            </span>
            <textarea rows={7} value={m.description} onChange={(e) => setMeta((d) => void (d.description = e.target.value))} />
          </label>
          <fieldset className="keyword-grid">
            <legend>Keywords</legend>
            {keywords.map((k, i) => (
              <input
                key={i}
                aria-label={`Keyword ${i + 1}`}
                value={k}
                onChange={(e) =>
                  setMeta((d) => {
                    const next = [...keywords];
                    next[i] = e.target.value;
                    while (next.length && !next[next.length - 1].trim()) next.pop();
                    d.keywords = next;
                  })
                }
              />
            ))}
          </fieldset>
          <div className="row">
            <label className="field" style={{ width: 140 }}>
              List price (USD)
              <input type="number" min={0} step={0.01} value={m.listPriceUsd} onChange={(e) => setMeta((d) => void (d.listPriceUsd = Number(e.target.value) || 0))} />
            </label>
            <span className="muted" style={{ fontSize: 13 }}>Categories: {m.categories.join(" · ") || "none yet"}</span>
          </div>
          {v.errors.map((e) => (
            <div key={e} className="notice notice-fail">
              {e}
            </div>
          ))}
          <RegenerateBox what="listing" placeholder='e.g. "mention it makes a good gift", "less formal"' busy={busy === "listing"} disabled={busy !== null} onRun={(f) => act("listing", (p) => regenerateListingWithAi(p, f))} />
        </section>
      </div>

      <aside className="stack sticky-aside">
        <section className="card stack" aria-labelledby="review-score">
          <div className="row" style={{ gap: 14 }}>
            <div className="score-ring" style={{ ["--p" as string]: card.score }} role="img" aria-label={`Ready-to-publish score ${card.score} of 100`}>
              <span>{card.score}</span>
            </div>
            <div>
              <h2 id="review-score" style={{ margin: 0 }}>
                Scorecard
              </h2>
              <div className="muted" style={{ fontSize: 13 }}>
                {card.ready ? "Ready to export" : "Not ready yet"}
              </div>
            </div>
          </div>
          <ul className="score-rows" aria-label="Scorecard">
            {card.rows.map((r) => (
              <li key={r.id}>
                <span className={`check-icon ${r.status}`} aria-label={r.status}>
                  {ICON[r.status]}
                </span>
                <div>
                  <strong>{r.label}</strong> <span className="muted">{r.points}/{r.max}</span>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.detail}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {card.fixes.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <strong style={{ fontSize: 13 }}>One-click fixes</strong>
              {card.fixes.map((f) => (
                <button key={`${f.check}-${f.fixId}`} className="btn btn-sm" onClick={() => fix([f.fixId])} disabled={busy !== null}>
                  {f.label} <span className="muted">({f.check})</span>
                </button>
              ))}
              {card.fixes.length > 1 && (
                <button className="btn btn-sm btn-primary" onClick={() => fix([...new Set(card.fixes.map((f) => f.fixId))])} disabled={busy !== null}>
                  Apply all {card.fixes.length} fixes
                </button>
              )}
            </div>
          )}
          {listingReview?.revised && listingReview.provider !== "offline" && listingReview.score < 8 && (
            <button className="btn btn-sm" onClick={applyRevision} disabled={busy !== null}>
              Apply the critic&apos;s listing ({listingReview.score}/10)
            </button>
          )}
          <button className="btn btn-sm" onClick={runReviews} disabled={busy !== null}>
            {busy === "reviews" && <span className="spinner" />} {offline ? "Re-check listing" : "Run AI reviews again"}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => onGo("quality")}>
            See every finding
          </button>
        </section>

        <section className="card stack" aria-labelledby="review-disclosure">
          <h2 id="review-disclosure" style={{ margin: 0 }}>
            AI disclosure
          </h2>
          <div className="grid grid-3" style={{ gap: 8 }}>
            {disclosure("text", "Text", usage.text)}
            {disclosure("images", "Images", usage.images)}
            {disclosure("translation", "Translations", false)}
          </div>
          <label className="check">
            <input type="checkbox" checked={m.aiDisclosure.confirmed} onChange={(e) => setMeta((d) => void (d.aiDisclosure.confirmed = e.target.checked))} />
            <span>These answers are correct; I&apos;ll give them to KDP.</span>
          </label>
        </section>

        <section className="card stack" aria-labelledby="review-publish">
          <h2 id="review-publish" style={{ margin: 0 }}>
            Publish
          </h2>
          {report.blocking > 0 ? (
            <div className="notice notice-fail">
              {report.blocking} blocking preflight issue{report.blocking > 1 ? "s" : ""}. You can export a draft, but KDP will likely reject it.
            </div>
          ) : (
            <div className="notice notice-pass">Preflight passed ({report.passed}/{report.total}).</div>
          )}
          <label className="check">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            <span>I reviewed the cover, pages and listing, and I hold the rights to everything in this book.</span>
          </label>
          <button className="btn btn-primary" disabled={!approved || busy !== null} onClick={exportPackage}>
            {busy === "export" && <span className="spinner" />} Export {report.blocking ? "draft " : ""}KDP package (.zip)
          </button>
          {progress && (
            <div className="progress" aria-label={progress.label}>
              <div style={{ width: `${Math.round(progress.f * 100)}%` }} />
            </div>
          )}
          <p className="field-hint" style={{ margin: 0 }}>
            BookStudio never publishes for you. Upload the files in KDP, check the Print Previewer and press Publish yourself.
          </p>
        </section>
      </aside>
    </div>
  );
}
