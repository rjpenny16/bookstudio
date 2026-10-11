"use client";

import { useEffect, useMemo, useState } from "react";
import { aiStatus, type AiStatus } from "@/lib/ai/client";
import { applyRevisedListing, qualityReport } from "@/lib/quality";
import type { Severity } from "@/lib/quality/content";
import { critiqueListing, reviewVisuals } from "@/lib/quality/review";
import type { ReviewFinding, StoredReview } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";
import type { TabId } from "./Workspace";

const BADGE: Record<Severity, string> = { high: "badge-fail", medium: "badge-warn", low: "badge-info" };
const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function Sev({ s }: { s: Severity }) {
  return <span className={`badge ${BADGE[s]}`}>{s}</span>;
}

function FindingList({ items, label }: { items: { severity: Severity; text: string; hint?: string }[]; label: string }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return (
    <ul className="quality-list" aria-label={label}>
      {sorted.map((f, i) => (
        <li key={i}>
          <Sev s={f.severity} />
          <div>
            <div>{f.text}</div>
            {f.hint && <div className="muted">{f.hint}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function StoredHeader({ review, title }: { review: StoredReview; title: string }) {
  return (
    <div className="row-between">
      <strong>{title}</strong>
      <span className="muted" style={{ fontSize: 12 }}>
        {review.provider === "offline" ? "offline" : `${review.score}/10`} · {review.model} · {new Date(review.at).toLocaleString()}
      </span>
    </div>
  );
}

const asItems = (fs: ReviewFinding[], prefix = true) => fs.map((f) => ({ severity: f.severity, text: prefix ? `${f.target}: ${f.issue}` : f.issue, hint: f.suggestion }));

export function QualityTab({ onGo }: { onGo: (tab: TabId) => void }) {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const report = useMemo(() => qualityReport(project), [project]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<"listing" | "visual" | null>(null);
  const [note, setNote] = useState<{ kind: "info" | "fail" | "pass"; text: string } | null>(null);
  const offline = status?.provider === "offline";

  useEffect(() => {
    aiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const run = async (which: "listing" | "visual") => {
    setBusy(which);
    setNote(null);
    try {
      if (which === "listing") {
        const { review, run } = await critiqueListing(project);
        update((d) => {
          d.reviews = { ...d.reviews, listing: review };
          if (run) d.modelRuns.push(run);
        });
      } else {
        const { review, run } = await reviewVisuals(project);
        update((d) => {
          d.reviews = { ...d.reviews, visual: review };
          if (run) d.modelRuns.push(run);
        });
      }
    } catch (e) {
      setNote({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const listingReview = report.reviews.listing;
  const visual = report.reviews.visual;
  const applyRevision = () => {
    if (!listingReview?.revised) return;
    const { metadata, changed } = applyRevisedListing(project, listingReview.revised);
    if (!changed.length) {
      setNote({ kind: "info", text: "The suggested listing matches yours, or would add listing errors, so nothing was changed." });
      return;
    }
    update((d) => {
      d.metadata = metadata;
      const r = d.modelRuns.findLast((m) => m.task === "listing-critique");
      if (r) r.outputs.push(...changed.map((c) => `listing.${c}`).filter((o) => !r.outputs.includes(o)));
    });
    setNote({ kind: "pass", text: `Updated ${changed.join(", ")}. If the title changed, rebuild the cover and title page so they match.` });
  };

  const contentIssues = report.content.reduce((n, s) => n + s.issues.length, 0);
  return (
    <div className="split-aside">
      <div className="stack">
        {note && <div className={`notice notice-${note.kind}`}>{note.text}</div>}

        <div className="card stack">
          <div className="row-between">
            <h2 style={{ margin: 0 }}>Listing</h2>
            <div className="row">
              <button className="btn btn-sm" onClick={() => onGo("listing")}>
                Edit listing
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => run("listing")} disabled={busy !== null}>
                {busy === "listing" && <span className="spinner" />} Critique listing with AI
              </button>
            </div>
          </div>
          {report.listing.length === 0 && !listingReview && <div className="notice notice-pass">No listing problems found by the rule checks.</div>}
          <FindingList label="Listing checks" items={report.listing.map((n) => ({ severity: n.severity, text: `${n.field}: ${n.issue}`, hint: n.suggestion }))} />
          {listingReview && (
            <div className="stack review-block">
              <StoredHeader review={listingReview} title="AI critique" />
              <p style={{ margin: 0 }}>{listingReview.summary}</p>
              <FindingList label="AI listing findings" items={asItems(listingReview.findings)} />
              {listingReview.revised && (
                <details>
                  <summary>Suggested revision</summary>
                  <dl className="revision">
                    <dt>Title</dt>
                    <dd>{listingReview.revised.title}</dd>
                    <dt>Subtitle</dt>
                    <dd>{listingReview.revised.subtitle}</dd>
                    <dt>Keywords</dt>
                    <dd>{listingReview.revised.keywords.join(" · ")}</dd>
                    <dt>Categories</dt>
                    <dd>{listingReview.revised.categories.join(" · ") || "unchanged"}</dd>
                    <dt>Description</dt>
                    <dd style={{ whiteSpace: "pre-wrap" }}>{listingReview.revised.description}</dd>
                  </dl>
                  <button className="btn btn-sm" onClick={applyRevision}>
                    Apply suggested listing
                  </button>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="row-between">
            <h2 style={{ margin: 0 }}>Cover &amp; pages</h2>
            <button className="btn btn-primary btn-sm" onClick={() => run("visual")} disabled={busy !== null || offline}>
              {busy === "visual" && <span className="spinner" />} Review cover &amp; pages with AI
            </button>
          </div>
          {offline && <p className="field-hint" style={{ margin: 0 }}>The visual review needs a model that can see images (Claude, or a vision model in Ollama). The rule checks below still run offline.</p>}
          {report.design.length === 0 && <div className="notice notice-pass">No design problems found by the rule checks.</div>}
          <FindingList label="Design checks" items={report.design.map((n) => ({ severity: n.severity, text: `${n.area === "cover" ? "Cover" : `Page ${(n.pageIndex ?? 0) + 1}`}: ${n.issue}`, hint: n.suggestion }))} />
          {visual && (
            <div className="stack review-block">
              <StoredHeader review={visual} title="AI visual review" />
              <p style={{ margin: 0 }}>{visual.summary}</p>
              {!visual.thumbnailReadable && <div className="notice notice-warn">The reviewer couldn&apos;t read the title on the thumbnail-size cover.</div>}
              <FindingList label="AI visual findings" items={asItems(visual.findings)} />
              <p className="field-hint" style={{ margin: 0 }}>
                Reviewed: {visual.images.join(", ")}.
              </p>
            </div>
          )}
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>Content</h2>
          {contentIssues === 0 ? (
            <div className="notice notice-pass">No repeated prompts, weak word lists or problem sayings found.</div>
          ) : (
            report.content.map((s) => <FindingList key={s.sectionId} label={s.label} items={s.issues.map((i) => ({ severity: i.severity, text: `${s.label}: ${i.message}`, hint: i.item && !i.message.includes(i.item) ? `“${i.item}”` : undefined }))} />)
          )}
        </div>
      </div>

      <aside className="stack sticky-aside">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Quality review</h2>
          <div className="grid grid-3">
            {(["high", "medium", "low"] as const).map((s) => (
              <div className="stat" key={s}>
                <span className="stat-label">{s}</span>
                <span className="stat-value">{report.counts[s]}</span>
              </div>
            ))}
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            Rule-check findings by severity. Model reviews show their own scores.
          </p>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Preflight checks what KDP will accept. This tab checks what buyers will notice: repeated or weak content, a cover that disappears as a thumbnail, and a listing that doesn&apos;t say what&apos;s inside. Nothing here blocks export.
          </p>
        </div>
        <div className="card">
          <h3>How it works</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-2)" }}>
            <li>Rule checks run on every change, offline.</li>
            <li>The listing critique uses a curated list of real Amazon Books categories.</li>
            <li>The visual review renders the cover, a thumbnail and sample pages and shows them to the model.</li>
            <li>Model reviews are saved with the project and recorded in its provenance.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
