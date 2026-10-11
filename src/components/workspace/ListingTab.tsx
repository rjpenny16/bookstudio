"use client";

import { useState } from "react";
import { callAi, isModelOutput, modelRun } from "@/lib/ai/client";
import { findTrim, royaltyUsd } from "@/lib/kdp/geometry";
import { LISTING } from "@/lib/kdp/rules";
import { cleanKeywords, validateListing } from "@/lib/metadata/validate";
import { aiUsage } from "@/lib/preflight/aiUsage";
import { isLowContent, type AiDisclosureLevel } from "@/lib/schema/project";
import { useProjectStore } from "@/lib/storage/store";

const CATEGORY_SUGGESTIONS = [
  "Books > Self-Help > Journal Writing",
  "Books > Self-Help > Personal Transformation",
  "Books > Health, Fitness & Dieting > Mental Health > Happiness",
  "Books > Business & Money > Skills > Time Management",
  "Books > Crafts, Hobbies & Home > Crafts & Hobbies > Journaling",
  "Books > Humor & Entertainment > Puzzles & Games > Sudoku",
  "Books > Humor & Entertainment > Puzzles & Games > Word Search",
  "Books > Humor & Entertainment > Puzzles & Games > Mazes",
  "Books > Humor & Entertainment > Puzzles & Games > Logic & Brain Teasers",
  "Books > Children's Books > Activities, Crafts & Games > Activity Books",
  "Books > Children's Books > Activities, Crafts & Games > Coloring Books",
  "Books > Crafts, Hobbies & Home > Coloring Books for Grown-Ups",
  "Books > Arts & Photography > Music > Songbooks",
  "Books > Education & Teaching > Schools & Teaching > Early Childhood Education",
];

function trimTrailing(xs: string[]): string[] {
  const out = [...xs];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

function Count({ n, max }: { n: number; max: number }) {
  return <span className={`counter${n > max ? " over" : ""}`}>{n}/{max}</span>;
}

export function ListingTab() {
  const project = useProjectStore((s) => s.project)!;
  const update = useProjectStore((s) => s.update);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "info" | "fail"; text: string } | null>(null);
  const m = project.metadata;
  const n = project.interior.pages.length;
  const v = validateListing(m, project.bookType);
  const r = royaltyUsd(project.spec, n, m.listPriceUsd);
  const usage = aiUsage(project);
  const low = isLowContent(project.bookType);
  const ts = m.title.length + m.subtitle.length;
  const set = (fn: (d: typeof m) => void) =>
    update((d) => {
      fn(d.metadata);
    });

  const generate = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await callAi("listing", {
        topic: project.brief.topic || m.title || project.name,
        audience: project.brief.audience || "adults",
        bookType: project.bookType,
        angle: project.brief.angle,
        workingTitle: m.title || project.name,
        author: m.author,
        interiorSummary: project.brief.interiorPlan || describeInterior(),
        pageCount: n,
        trim: findTrim(project.spec.trimId)?.label ?? `${project.spec.widthIn}x${project.spec.heightIn}`,
        keywordIdeas: project.brief.keywordIdeas.length ? project.brief.keywordIdeas : m.keywords,
      });
      const L = res.output;
      update((d) => {
        d.metadata.title = L.title || d.metadata.title;
        d.metadata.subtitle = L.subtitle;
        d.metadata.description = L.description;
        d.metadata.keywords = cleanKeywords(L.keywords);
        if (L.categories.length) d.metadata.categories = L.categories.slice(0, 3);
        if (isModelOutput(res.meta)) d.modelRuns.push(modelRun(res.meta, ["listing.title", "listing.description", "listing.keywords"]));
      });
      setNote({ kind: "info", text: `Drafted by ${res.meta.provider} (${res.meta.model}). Review every field before publishing. Suggested price: $${L.suggestedPriceUsd.toFixed(2)}.` });
    } catch (e) {
      setNote({ kind: "fail", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  function describeInterior() {
    const kinds = new Map<string, number>();
    for (const p of project.interior.pages) {
      const k = p.generator?.kind ?? "custom";
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    return [...kinds.entries()].map(([k, c]) => `${c} ${k.replace(/-/g, " ")} pages`).join(", ");
  }

  const keywords = [...m.keywords, ...Array(Math.max(0, LISTING.maxKeywords - m.keywords.length)).fill("")].slice(0, LISTING.maxKeywords);
  const disclosure = (key: "text" | "images" | "translation", label: string, detected: boolean) => (
    <div className="field">
      <label>
        {label}
        {detected && <span className="badge badge-info"> detected in provenance</span>}
        <select
          value={m.aiDisclosure[key]}
          onChange={(e) =>
            set((d) => {
              d.aiDisclosure[key] = e.target.value as AiDisclosureLevel;
              d.aiDisclosure.confirmed = false;
            })
          }
        >
          <option value="none">None</option>
          <option value="some">Some (AI-generated, with or without edits)</option>
          <option value="most">Most or all</option>
        </select>
      </label>
    </div>
  );

  return (
    <div className="split-aside">
      <div className="stack">
        <div className="card stack">
          <div className="row-between">
            <h2 style={{ margin: 0 }}>Book details</h2>
            <button className="btn btn-primary" onClick={generate} disabled={busy}>
              {busy && <span className="spinner" />} Draft listing with AI
            </button>
          </div>
          {note && <div className={`notice notice-${note.kind}`}>{note.text}</div>}
          <div className="field">
            <label>
              <span className="row-between">
                Title <Count n={ts} max={LISTING.maxTitleSubtitleChars} />
              </span>
              <input value={m.title} onChange={(e) => set((d) => void (d.title = e.target.value))} />
            </label>
          </div>
          <div className="field">
            <label>
              Subtitle
              <input value={m.subtitle} onChange={(e) => set((d) => void (d.subtitle = e.target.value))} />
            </label>
          </div>
          <div className="field-row">
            <div className="field">
              <label>
                Author / pen name
                <input value={m.author} onChange={(e) => set((d) => void (d.author = e.target.value))} />
              </label>
            </div>
            <div className="field">
              <label>
                Series (optional)
                <input value={m.series} onChange={(e) => set((d) => void (d.series = e.target.value))} />
              </label>
            </div>
            <div className="field">
              <label>
                Edition (optional)
                <input value={m.edition} onChange={(e) => set((d) => void (d.edition = e.target.value))} />
              </label>
            </div>
          </div>
          <div className="field">
            <label>
              <span className="row-between">
                Description <Count n={m.description.length} max={LISTING.maxDescriptionChars} />
              </span>
              <textarea rows={9} value={m.description} onChange={(e) => set((d) => void (d.description = e.target.value))} />
            </label>
          </div>
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>Keywords & categories</h2>
          <p className="muted" style={{ margin: 0 }}>
            Seven backend keyword slots, up to {LISTING.maxKeywordChars} characters each. Do not repeat title words or use claims like "best seller" or "free".
          </p>
          <div className="grid grid-2">
            {keywords.map((k, i) => (
              <div className="field" key={i}>
                <label>
                  <span className="row-between">
                    Keyword {i + 1} <Count n={k.length} max={LISTING.maxKeywordChars} />
                  </span>
                  <input
                    value={k}
                    onChange={(e) =>
                      set((d) => {
                        const next = [...keywords];
                        next[i] = e.target.value;
                        d.keywords = trimTrailing(next);
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <datalist id="kdp-categories">
            {CATEGORY_SUGGESTIONS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="grid grid-3">
            {[0, 1, 2].map((i) => (
              <div className="field" key={i}>
                <label>
                  Category {i + 1}
                  <input
                    list="kdp-categories"
                    value={m.categories[i] ?? ""}
                    onChange={(e) =>
                      set((d) => {
                        const c = [0, 1, 2].map((j) => d.categories[j] ?? "");
                        c[i] = e.target.value;
                        d.categories = trimTrailing(c);
                      })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <p className="field-hint">Category paths are suggestions; pick the closest match in KDP&apos;s category browser when you publish.</p>
        </div>

        <div className="card stack">
          <h2 style={{ margin: 0 }}>AI-generated content disclosure</h2>
          <p className="muted" style={{ margin: 0 }}>
            KDP requires you to disclose AI-generated text, images and translations, including cover art, even if you edited them afterward. AI-assisted work (you wrote it, AI helped edit or brainstorm) does not need disclosure.
          </p>
          <div className="grid grid-3">
            {disclosure("text", "Text", usage.text)}
            {disclosure("images", "Images", usage.images)}
            {disclosure("translation", "Translations", false)}
          </div>
          {(usage.text || usage.images) && (
            <div className="notice notice-info">
              Provenance shows AI-generated content in: {[...usage.textSources, ...usage.imageSources].slice(0, 6).join(", ")}.
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={m.aiDisclosure.confirmed} onChange={(e) => set((d) => void (d.aiDisclosure.confirmed = e.target.checked))} />
            <span>I have reviewed these answers and will give them to KDP.</span>
          </label>
        </div>
      </div>

      <aside className="stack sticky-aside">
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Pricing (amazon.com)</h2>
          <div className="field">
            <label>
              List price (USD)
              <input type="number" min={0} step={0.01} value={m.listPriceUsd} onChange={(e) => set((d) => void (d.listPriceUsd = Number(e.target.value) || 0))} />
            </label>
          </div>
          <div className="grid grid-2">
            <div className="stat">
              <span className="stat-label">Print cost</span>
              <span className="stat-value">${r.printCost.toFixed(2)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Royalty ({Math.round(r.rate * 100)}%)</span>
              <span className="stat-value" style={{ color: r.royalty < 0 ? "var(--fail)" : undefined }}>
                ${r.royalty.toFixed(2)}
              </span>
            </div>
          </div>
          <p className="field-hint" style={{ margin: 0 }}>
            Minimum price ${r.minListPrice.toFixed(2)}. 60% royalty at $9.99 and above, 50% below. {low ? "Expanded Distribution is not available for low-content books." : `Expanded Distribution royalty: $${r.expandedRoyalty.toFixed(2)}.`}
          </p>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>ISBN & content</h2>
          <div className="field">
            <label>
              ISBN
              <select value={m.isbn.kind} onChange={(e) => set((d) => void (d.isbn.kind = e.target.value as typeof m.isbn.kind))}>
                <option value="none">No ISBN {low ? "(low-content)" : ""}</option>
                <option value="kdp-free" disabled={low}>
                  Free KDP ISBN {low ? "(not for low-content)" : ""}
                </option>
                <option value="own">My own ISBN</option>
              </select>
            </label>
          </div>
          {m.isbn.kind === "own" && (
            <div className="field">
              <label>
                ISBN-13
                <input value={m.isbn.value} onChange={(e) => set((d) => void (d.isbn.value = e.target.value))} />
              </label>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={m.adultContent} onChange={(e) => set((d) => void (d.adultContent = e.target.checked))} /> Sexually explicit content (adult)
          </label>
          <span className="badge">{low ? "Low-content book" : "Not low-content"}</span>
        </div>
        <div className="card stack">
          <h2 style={{ margin: 0 }}>Checks</h2>
          {v.errors.length === 0 && v.warnings.length === 0 && <div className="notice notice-pass">Listing looks complete.</div>}
          {v.errors.map((e) => (
            <div key={e} className="notice notice-fail">
              {e}
            </div>
          ))}
          {v.warnings.map((w) => (
            <div key={w} className="notice notice-warn">
              {w}
            </div>
          ))}
          {v.cleanable && (
            <button className="btn btn-sm" onClick={() => set((d) => void (d.keywords = cleanKeywords(d.keywords)))}>
              Clean up keywords
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
