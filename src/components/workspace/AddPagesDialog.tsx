"use client";

import { useEffect, useRef, useState } from "react";
import { callAi, isModelOutput, modelRun } from "@/lib/ai/client";
import { estimatePageCount, generatePages, GENERATORS, type GeneratorConfig } from "@/lib/generators/pages";
import { randomSeed } from "@/lib/generators/rng";
import { styleOf } from "@/lib/generators/style";
import type { Asset, ModelRun, Page, Project } from "@/lib/schema/project";
import { fileToAsset } from "@/lib/storage/assets";

interface Props {
  open: boolean;
  onClose: () => void;
  project: Project;
  currentIndex: number;
  onInsert: (pages: Page[], at: number, extra: { assets: Asset[]; runs: ModelRun[] }) => void;
}

function Num({ label, value, onChange, min = 1, max = 1000, step = 1 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <div className="field">
      <label>
        {label}
        <input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))} />
      </label>
    </div>
  );
}

export function AddPagesDialog({ open, onClose, project, currentIndex, onInsert }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cfg, setCfg] = useState<GeneratorConfig>(GENERATORS[0].defaults());
  const [position, setPosition] = useState<"end" | "after">("end");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [runs, setRuns] = useState<ModelRun[]>([]);
  const [newAssets, setNewAssets] = useState<Asset[]>([]);
  const [topic, setTopic] = useState(project.brief.topic || project.metadata.title || "");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const set = (patch: Partial<GeneratorConfig>) => setCfg((c) => ({ ...c, ...patch }) as GeneratorConfig);

  const aiFill = async () => {
    setAiBusy(true);
    setAiNote(null);
    try {
      if (cfg.kind === "journal-prompts") {
        const r = await callAi("journal-prompts", { topic, audience: project.brief.audience || "adults", count: Math.max(1, cfg.prompts.length) });
        const run = isModelOutput(r.meta) ? modelRun(r.meta, ["interior.prompts"]) : null;
        if (run) setRuns((x) => [...x, run]);
        setCfg({ ...cfg, prompts: r.output.prompts, aiRunId: run?.id });
        setAiNote(`${r.output.prompts.length} prompts from ${r.meta.provider} (${r.meta.model})`);
      } else if (cfg.kind === "word-search" || cfg.kind === "word-scramble") {
        const r = cfg.kind === "word-search"
          ? await callAi("word-lists", { topic, audience: project.brief.audience || "adults", count: Math.max(1, cfg.puzzles.length), wordsPerPuzzle: cfg.difficulty === "easy" ? 10 : 15, maxLength: cfg.size - 2 })
          : await callAi("word-lists", { topic, audience: project.brief.audience || "adults", count: Math.max(1, cfg.puzzles.length), wordsPerPuzzle: 15, maxLength: 10 });
        const run = isModelOutput(r.meta) ? modelRun(r.meta, ["interior.word-lists"]) : null;
        if (run) setRuns((x) => [...x, run]);
        setCfg({ ...cfg, puzzles: r.output.puzzles, aiRunId: run?.id });
        setAiNote(`${r.output.puzzles.length} word lists from ${r.meta.provider} (${r.meta.model})`);
      }
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  };

  const insert = () => {
    const assets = [...project.assets, ...newAssets];
    const pages = generatePages(cfg, { spec: project.spec, pageCountHint: project.interior.pages.length + estimatePageCount(cfg), assets, style: styleOf(project) });
    onInsert(pages, position === "end" ? project.interior.pages.length : currentIndex + 1, { assets: newAssets, runs });
    setRuns([]);
    setNewAssets([]);
    onClose();
  };

  const est = estimatePageCount(cfg);
  const groups = [...new Set(GENERATORS.map((g) => g.group))];
  const allAssets = [...project.assets, ...newAssets];

  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-labelledby="add-pages-title">
      <div className="modal-head">
        <h2 id="add-pages-title" style={{ margin: 0 }}>
          Add pages
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body stack">
        <div className="field">
          <label>
            Page type
            <select
              value={cfg.kind}
              onChange={(e) => {
                const g = GENERATORS.find((x) => x.kind === e.target.value)!;
                const d = g.defaults();
                if (d.kind === "title-page") Object.assign(d, { title: project.metadata.title || project.name, subtitle: project.metadata.subtitle, author: project.metadata.author });
                setCfg(d);
                setAiNote(null);
              }}
            >
              {groups.map((grp) => (
                <optgroup key={grp} label={grp}>
                  {GENERATORS.filter((g) => g.group === grp).map((g) => (
                    <option key={g.kind} value={g.kind}>
                      {g.label}: {g.description}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row">
          {"count" in cfg && <Num label={cfg.kind === "sudoku" || cfg.kind === "maze" || cfg.kind === "number-search" ? "Puzzles" : cfg.kind === "monthly-calendar" ? "Months" : cfg.kind === "weekly-spread" ? "Weeks" : "Pages"} value={cfg.count} onChange={(count) => set({ count })} max={cfg.kind === "sudoku" ? 600 : 800} />}
          {(cfg.kind === "lined" || cfg.kind === "journal-prompts") && <Num label="Line spacing (in)" value={cfg.spacingIn} step={0.03125} min={0.2} max={1} onChange={(spacingIn) => set({ spacingIn })} />}
          {(cfg.kind === "dot-grid" || cfg.kind === "graph") && <Num label="Spacing (in)" value={cfg.spacingIn} step={0.0625} min={0.125} max={1} onChange={(spacingIn) => set({ spacingIn })} />}
          {cfg.kind === "graph" && <Num label="Bold line every" value={cfg.majorEvery} min={0} max={10} onChange={(majorEvery) => set({ majorEvery })} />}
          {cfg.kind === "handwriting" && <Num label="Row height (in)" value={cfg.rowHeightIn} step={0.125} min={0.375} max={2} onChange={(rowHeightIn) => set({ rowHeightIn })} />}
          {cfg.kind === "music" && <Num label="Staves per page" value={cfg.staves} min={4} max={14} onChange={(staves) => set({ staves })} />}
          {cfg.kind === "habit-tracker" && <Num label="Habits" value={cfg.habits} min={3} max={30} onChange={(habits) => set({ habits })} />}
          {cfg.kind === "log" && <Num label="Rows per page" value={cfg.rows} min={5} max={50} onChange={(rows) => set({ rows })} />}
          {(cfg.kind === "sudoku" || cfg.kind === "maze" || cfg.kind === "word-search" || cfg.kind === "number-search" || cfg.kind === "cryptogram") && (
            <div className="field">
              <label>
                Difficulty
                <select value={cfg.difficulty} onChange={(e) => set({ difficulty: e.target.value as never })}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  {cfg.kind === "sudoku" && <option value="expert">Expert</option>}
                </select>
              </label>
            </div>
          )}
          {cfg.kind === "sudoku" && (
            <div className="field">
              <label>
                Per page
                <select value={cfg.perPage} onChange={(e) => set({ perPage: Number(e.target.value) as 1 | 2 | 4 })}>
                  <option value={1}>1 (large print)</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </label>
            </div>
          )}
          {(cfg.kind === "word-search" || cfg.kind === "number-search") && <Num label="Grid size" value={cfg.size} min={8} max={24} onChange={(size) => set({ size })} />}
          {cfg.kind === "cryptogram" && (
            <div className="field">
              <label>
                Per page
                <select value={cfg.perPage} onChange={(e) => set({ perPage: Number(e.target.value) as 1 | 2 })}>
                  <option value={1}>1 (large print)</option>
                  <option value={2}>2</option>
                </select>
              </label>
            </div>
          )}
          {(cfg.kind === "monthly-calendar" || cfg.kind === "weekly-spread") && (
            <div className="field">
              <label>
                Start month (blank = undated)
                <input type="month" value={cfg.startDate} onChange={(e) => set({ startDate: e.target.value })} />
              </label>
            </div>
          )}
        </div>

        {(cfg.kind === "text-page" || cfg.kind === "section-divider") && (
          <div className="stack">
            <div className="field">
              <label>
                Heading
                <input value={cfg.title} onChange={(e) => set({ title: e.target.value })} />
              </label>
            </div>
            <div className="field">
              <label>
                {cfg.kind === "text-page" ? "Text (blank line between paragraphs)" : "Subtitle"}
                <textarea rows={cfg.kind === "text-page" ? 8 : 2} value={cfg.kind === "text-page" ? cfg.body : cfg.subtitle} onChange={(e) => set(cfg.kind === "text-page" ? { body: e.target.value, aiRunId: undefined } : { subtitle: e.target.value, aiRunId: undefined })} />
              </label>
            </div>
          </div>
        )}

        {cfg.kind === "table-of-contents" && (
          <div className="field">
            <label>
              Entries (one per line: <code>Title | page</code>)
              <textarea
                rows={6}
                value={cfg.entries.map((e) => `${e.title} | ${e.page}`).join("\n")}
                onChange={(e) =>
                  set({
                    entries: e.target.value
                      .split("\n")
                      .map((ln) => {
                        const [t, n] = ln.split("|");
                        return { title: (t ?? "").trim(), page: Number(n) || 0 };
                      })
                      .filter((x) => x.title),
                  })
                }
              />
            </label>
          </div>
        )}

        {cfg.kind === "cryptogram" && (
          <div className="field">
            <label>
              Sayings (one per line, one puzzle each). Write your own or use sayings you have the rights to.
              <textarea rows={6} value={cfg.phrases.join("\n")} onChange={(e) => set({ phrases: e.target.value.split("\n"), aiRunId: undefined })} />
            </label>
          </div>
        )}

        {(cfg.kind === "sudoku" || cfg.kind === "maze" || cfg.kind === "word-search" || cfg.kind === "number-search" || cfg.kind === "word-scramble" || cfg.kind === "cryptogram") && (
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={cfg.solutions} onChange={(e) => set({ solutions: e.target.checked })} /> Include answer key
            </label>
            <span className="muted" style={{ fontSize: 12 }}>
              Seed {cfg.seed} (same seed, same puzzles)
            </span>
            <button className="btn btn-sm" onClick={() => set({ seed: randomSeed() })}>
              New seed
            </button>
          </div>
        )}

        {cfg.kind === "log" && (
          <div className="field-row">
            <div className="field">
              <label>
                Title
                <input value={cfg.title} onChange={(e) => set({ title: e.target.value })} />
              </label>
            </div>
            <div className="field">
              <label>
                Columns (comma-separated)
                <input value={cfg.columns.join(", ")} onChange={(e) => set({ columns: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              </label>
            </div>
          </div>
        )}

        {cfg.kind === "title-page" && (
          <div className="field-row">
            {(["title", "subtitle", "author"] as const).map((k) => (
              <div className="field" key={k}>
                <label>
                  {k[0].toUpperCase() + k.slice(1)}
                  <input value={cfg[k]} onChange={(e) => set({ [k]: e.target.value })} />
                </label>
              </div>
            ))}
          </div>
        )}

        {(cfg.kind === "journal-prompts" || cfg.kind === "word-search" || cfg.kind === "word-scramble") && (
          <div className="card stack" style={{ boxShadow: "none" }}>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label>
                  Topic for AI
                  <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. gratitude for new moms, ocean animals" />
                </label>
              </div>
              <Num
                label={cfg.kind === "journal-prompts" ? "Prompts" : "Puzzles"}
                value={cfg.kind === "journal-prompts" ? cfg.prompts.length : cfg.puzzles.length}
                max={200}
                onChange={(n) =>
                  cfg.kind === "journal-prompts"
                    ? set({ prompts: Array.from({ length: n }, (_, i) => cfg.prompts[i] ?? "") })
                    : set({ puzzles: Array.from({ length: n }, (_, i) => cfg.puzzles[i] ?? { title: `Puzzle ${i + 1}`, words: [] }) })
                }
              />
              <button className="btn btn-primary" style={{ alignSelf: "end" }} onClick={aiFill} disabled={aiBusy || !topic.trim()}>
                {aiBusy ? <span className="spinner" /> : null} Generate with AI
              </button>
            </div>
            {aiNote && <div className="notice notice-info">{aiNote}</div>}
            {cfg.kind === "journal-prompts" ? (
              <div className="field">
                <label>
                  Prompts (one per line, one page each)
                  <textarea rows={8} value={cfg.prompts.join("\n")} onChange={(e) => set({ prompts: e.target.value.split("\n"), aiRunId: undefined })} />
                </label>
              </div>
            ) : (
              <div className="field">
                <label>
                  Word lists (one puzzle per line: <code>Title: word, word, …</code>)
                  <textarea
                    rows={8}
                    value={cfg.puzzles.map((p) => `${p.title}: ${p.words.join(", ")}`).join("\n")}
                    onChange={(e) =>
                      set({
                        aiRunId: undefined,
                        puzzles: e.target.value.split("\n").map((ln, i) => {
                          const [t, w] = ln.includes(":") ? [ln.slice(0, ln.indexOf(":")), ln.slice(ln.indexOf(":") + 1)] : [`Puzzle ${i + 1}`, ln];
                          return { title: t.trim(), words: w.split(",").map((s) => s.trim()).filter(Boolean) };
                        }),
                      })
                    }
                  />
                </label>
              </div>
            )}
            {cfg.aiRunId && <span className="badge badge-info">AI-generated text: will be flagged for KDP disclosure</span>}
          </div>
        )}

        {cfg.kind === "coloring" && (
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Upload black-and-white line art (PNG/JPG/SVG). Each image gets its own page{cfg.blankBacks ? " with a blank back so markers do not bleed through" : ""}. Use images you own or that are licensed for commercial use.
            </p>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={async (e) => {
                const files = [...(e.target.files ?? [])];
                const assets = await Promise.all(files.map((f) => fileToAsset(f)));
                setNewAssets((a) => [...a, ...assets]);
                set({ assetIds: [...cfg.assetIds, ...assets.map((a) => a.id)] });
              }}
            />
            <div className="chip-list">
              {allAssets.map((a) => (
                <label key={a.id} className="chip">
                  <input type="checkbox" checked={cfg.assetIds.includes(a.id)} onChange={(e) => set({ assetIds: e.target.checked ? [...cfg.assetIds, a.id] : cfg.assetIds.filter((x) => x !== a.id) })} />
                  {a.name}
                </label>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={cfg.blankBacks} onChange={(e) => set({ blankBacks: e.target.checked })} /> Blank page behind each image
            </label>
          </div>
        )}

        <div className="row">
          <span>Insert</span>
          <div className="btn-group" role="radiogroup" aria-label="Insert position">
            <button className="btn btn-sm" role="radio" aria-checked={position === "end"} onClick={() => setPosition("end")}>
              At the end
            </button>
            <button className="btn btn-sm" role="radio" aria-checked={position === "after"} onClick={() => setPosition("after")}>
              After page {currentIndex + 1}
            </button>
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <span className="muted" style={{ marginRight: "auto", alignSelf: "center" }}>
          ≈ {est} page{est === 1 ? "" : "s"} → {project.interior.pages.length + est} total
        </span>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={insert} disabled={est === 0}>
          Add {est} page{est === 1 ? "" : "s"}
        </button>
      </div>
    </dialog>
  );
}
