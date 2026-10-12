"use client";

import { AUTOPILOT_BOOK_TYPES, inferSetup } from "@/lib/agent/setup";
import { ART_CANDIDATES } from "@/lib/agent/constants";
import { estimateRun, formatTokens } from "@/lib/agent/estimate";
import { MAX_PAGES, MIN_PAGES } from "@/lib/agent/blueprint";
import type { AiStatus } from "@/lib/ai/client";
import type { ImageStatus } from "@/lib/cover/artClient";
import { ART_COVER_TEMPLATES, COVER_TEMPLATES, PALETTES } from "@/lib/cover/templates";
import { TRIM_SIZES } from "@/lib/kdp/rules";
import { BOOK_TYPES, type BookType } from "@/lib/schema/project";
import { DEFAULT_AUTHOR } from "@/lib/schema/factory";

/**
 * What autopilot needs to start: a niche and an audience. Book type and trim
 * are inferred (and shown with the reason); page count and cover style are
 * left to the brief. The Advanced section overrides any of them.
 */

export interface SetupState {
  topic: string;
  audience: string;
  /** Overrides; unset means inferred (book type, trim) or left to the brief (pages, style). */
  bookType?: BookType;
  trimId?: string;
  pageTarget?: number;
  templateId?: string;
  paletteId?: string;
  author: string;
  notes: string;
  coverArt: boolean;
}

/** Starting points shown as chips. */
export const EXAMPLES: { topic: string; audience: string }[] = [
  { topic: "gratitude journal for nurses", audience: "nurses and healthcare workers" },
  { topic: "large print sudoku", audience: "seniors" },
  { topic: "ocean animals word search", audience: "kids ages 6-9" },
  { topic: "fishing log book", audience: "anglers" },
];

export const emptySetup = (): SetupState => ({ topic: "", audience: "", author: DEFAULT_AUTHOR, notes: "", coverArt: true });

export function resolveSetup(s: SetupState) {
  const inferred = inferSetup(s.topic, s.audience);
  return { bookType: s.bookType ?? inferred.bookType, trimId: s.trimId ?? inferred.trimId, inferred };
}

/** Cover art runs when an image provider is set up, the box is ticked, and no vector template was chosen. */
export const artEnabled = (s: SetupState, images: ImageStatus | null) => Boolean(images?.configured && s.coverArt && (!s.templateId || ART_COVER_TEMPLATES.some((t) => t.id === s.templateId)));

const KEYS = ["topic", "audience", "bookType", "trimId", "pageTarget", "templateId", "paletteId", "author", "notes"] as const;

export function setupToParams(s: SetupState): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of KEYS) if (s[k] !== undefined && s[k] !== "") p.set(k, String(s[k]));
  if (!s.coverArt) p.set("coverArt", "0");
  return p;
}

export function setupFromParams(p: URLSearchParams): SetupState {
  const bookType = p.get("bookType") as BookType | null;
  const trimId = p.get("trimId");
  const pages = Number(p.get("pageTarget"));
  return {
    topic: p.get("topic") ?? "",
    audience: p.get("audience") ?? "",
    bookType: bookType && AUTOPILOT_BOOK_TYPES.includes(bookType) ? bookType : undefined,
    trimId: trimId && TRIM_SIZES.some((t) => t.id === trimId) ? trimId : undefined,
    pageTarget: pages >= MIN_PAGES && pages <= MAX_PAGES ? pages : undefined,
    templateId: p.get("templateId") ?? undefined,
    paletteId: p.get("paletteId") ?? undefined,
    author: p.get("author") || DEFAULT_AUTHOR,
    notes: p.get("notes") ?? "",
    coverArt: p.get("coverArt") !== "0",
  };
}

const typeLabel = (t: BookType) => BOOK_TYPES.find((b) => b.id === t)?.label ?? t;
const trimLabel = (id: string) => TRIM_SIZES.find((t) => t.id === id)?.label ?? id;

export function CostEstimate({ setup, status, images }: { setup: SetupState; status: AiStatus | null; images: ImageStatus | null }) {
  if (!status) return null;
  const art = artEnabled(setup, images);
  const e = estimateRun({ bookType: resolveSetup(setup).bookType, provider: status.provider, coverArt: art });
  if (e.offline)
    return (
      <p className="field-hint" style={{ margin: 0 }} aria-label="Cost estimate">
        Offline mode: no model calls and no cost. Built-in templates write the content.
      </p>
    );
  return (
    <p className="field-hint" style={{ margin: 0 }} aria-label="Cost estimate">
      Estimated: {e.modelCalls[0]}–{e.modelCalls[1]} calls to {status.model} (about {formatTokens(e.tokens[0])}–{formatTokens(e.tokens[1])} tokens, {e.visionCalls} with images)
      {e.images ? `, plus ${e.images} images from ${images?.model}` : ""}. Check your providers&apos; pricing pages for what that costs.
    </p>
  );
}

export function SetupForm({ value, onChange, images, disabled }: { value: SetupState; onChange: (s: SetupState) => void; images: ImageStatus | null; disabled?: boolean }) {
  const set = (patch: Partial<SetupState>) => onChange({ ...value, ...patch });
  const r = resolveSetup(value);
  const art = artEnabled(value, images);
  return (
    <fieldset className="stack" disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="field-row setup-main">
        <label className="field" style={{ flex: 2 }}>
          What is the book about?
          <input value={value.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. gratitude journal for nurses" />
        </label>
        <label className="field" style={{ flex: 1 }}>
          Who is it for?
          <input value={value.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="e.g. nurses, kids ages 6-9, seniors" />
        </label>
      </div>
      {value.topic.trim() && (
        <div className="setup-summary" aria-label="Detected setup">
          <span className="badge badge-accent">{typeLabel(r.bookType)}</span>
          <span className="badge">{trimLabel(r.trimId)}</span>
          <span className="badge">{value.pageTarget ? `${value.pageTarget} pages` : "page count: auto"}</span>
          <span className="muted">
            {value.bookType ? "Book type set by you" : `Book type: ${r.inferred.reasons.bookType}`}. {value.trimId ? "Trim set by you." : `Trim: ${r.inferred.reasons.trimId}.`}
          </span>
        </div>
      )}
      <details>
        <summary>Advanced</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="field-row">
            <label className="field">
              Book type
              <select value={value.bookType ?? ""} onChange={(e) => set({ bookType: (e.target.value || undefined) as BookType | undefined })}>
                <option value="">Auto ({typeLabel(r.inferred.bookType)})</option>
                {AUTOPILOT_BOOK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Trim
              <select value={value.trimId ?? ""} onChange={(e) => set({ trimId: e.target.value || undefined })}>
                <option value="">Auto ({trimLabel(r.inferred.trimId)})</option>
                {TRIM_SIZES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Pages
              <input
                type="number"
                min={MIN_PAGES}
                max={MAX_PAGES}
                step={2}
                value={value.pageTarget ?? ""}
                placeholder="Auto"
                onChange={(e) => set({ pageTarget: e.target.value ? Number(e.target.value) : undefined })}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              Cover template
              <select value={value.templateId ?? ""} onChange={(e) => set({ templateId: e.target.value || undefined })}>
                <option value="">Auto</option>
                <optgroup label="Vector templates">
                  {COVER_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
                {images?.configured && (
                  <optgroup label="With AI cover art">
                    {ART_COVER_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="field">
              Palette
              <select value={value.paletteId ?? ""} onChange={(e) => set({ paletteId: e.target.value || undefined })}>
                <option value="">Auto</option>
                {PALETTES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Author / pen name
              <input value={value.author} onChange={(e) => set({ author: e.target.value })} />
            </label>
          </div>
          <label className="field">
            Notes (optional)
            <textarea rows={2} value={value.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Tone, must-haves, things to avoid" />
          </label>
        </div>
      </details>
      {images?.configured && (
        <label className="check">
          <input type="checkbox" checked={art} disabled={!!value.templateId && !art} onChange={(e) => set({ coverArt: e.target.checked })} />
          Generate AI cover art ({ART_CANDIDATES} images with {images.model}; the best one is picked for the cover)
        </label>
      )}
    </fieldset>
  );
}
