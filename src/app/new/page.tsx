"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { estimatePageCount, GENERATORS, type GeneratorConfig } from "@/lib/generators/pages";
import { coverGeometry, findTrim, printCostUsd, spineWidthIn } from "@/lib/kdp/geometry";
import { isValidPaperInk, TRIM_SIZES } from "@/lib/kdp/rules";
import { createProject, DEFAULT_AUTHOR } from "@/lib/schema/factory";
import { BOOK_TYPES, isLowContent, type BookType, type InteriorInk, type Paper, type PrintSpec } from "@/lib/schema/project";
import { saveProject } from "@/lib/storage/db";
import { ptToIn, round } from "@/lib/util/ids";

const STARTERS: Record<BookType, string> = {
  notebook: "lined",
  journal: "journal-prompts",
  planner: "daily-planner",
  "log-book": "log",
  puzzle: "sudoku",
  coloring: "blank",
  activity: "maze",
  mystery: "story",
  other: "lined",
};

export default function NewBook() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [author, setAuthor] = useState(DEFAULT_AUTHOR);
  const [bookType, setBookType] = useState<BookType>("notebook");
  const [trimId, setTrimId] = useState("6x9");
  const [paper, setPaper] = useState<Paper>("white");
  const [ink, setInk] = useState<InteriorInk>("black");
  const [bleed, setBleed] = useState(false);
  const [frontMatter, setFrontMatter] = useState(true);
  const [kind, setKind] = useState(STARTERS.notebook);
  const [count, setCount] = useState(118);
  const [busy, setBusy] = useState(false);

  const cfg = useMemo<GeneratorConfig>(() => {
    const d = GENERATORS.find((g) => g.kind === kind)!.defaults();
    if ("count" in d) (d as { count: number }).count = count;
    return d;
  }, [kind, count]);

  const front: GeneratorConfig[] = frontMatter ? [{ kind: "title-page", title: name || "Untitled", subtitle: "", author }, ...(isLowContent(bookType) ? [{ kind: "belongs-to" } as GeneratorConfig] : [])] : [];
  const pages = front.reduce((n, c) => n + estimatePageCount(c), 0) + estimatePageCount(cfg);
  const trim = findTrim(trimId)!;
  const spec: PrintSpec = { marketplace: "amazon-kdp", binding: "paperback", trimId, widthIn: trim.widthIn, heightIn: trim.heightIn, bleed, paper, ink, coverFinish: "matte", rulesVersion: "" };
  const cg = coverGeometry(spec, pages);

  const create = async () => {
    setBusy(true);
    const p = createProject({ name: name || "Untitled book", bookType, trimId, paper, ink, bleed, author, interior: [...front, cfg] });
    await saveProject(p);
    router.push(`/projects/${p.id}#interior`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>New book</h1>
          <p>Choose the print specification once. Dimensions, bleed, gutter, spine and cover geometry are derived from it, never typed by hand.</p>
        </div>
      </div>
      <div className="split-aside">
        <div className="stack">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Book</h2>
            <div className="field-row">
              <div className="field">
                <label>
                  Working title
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Daily Gratitude Journal" />
                </label>
              </div>
              <div className="field">
                <label>
                  Author / pen name
                  <input value={author} onChange={(e) => setAuthor(e.target.value)} />
                </label>
              </div>
              <div className="field">
                <label>
                  Book type
                  <select
                    value={bookType}
                    onChange={(e) => {
                      const t = e.target.value as BookType;
                      setBookType(t);
                      setKind(STARTERS[t]);
                      setCount(t === "puzzle" ? 150 : t === "coloring" ? 0 : 118);
                    }}
                  >
                    {BOOK_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Print specification</h2>
            <div className="field-row">
              <div className="field">
                <label>
                  Trim size
                  <select value={trimId} onChange={(e) => setTrimId(e.target.value)}>
                    {TRIM_SIZES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                        {t.note ? `: ${t.note}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="field">
                <label>
                  Interior ink
                  <select
                    value={ink}
                    onChange={(e) => {
                      setInk(e.target.value as InteriorInk);
                      if (e.target.value !== "black") setPaper("white");
                    }}
                  >
                    <option value="black">Black & white</option>
                    <option value="standard-color">Standard color</option>
                    <option value="premium-color">Premium color</option>
                  </select>
                </label>
              </div>
              <div className="field">
                <label>
                  Paper
                  <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                    <option value="white">White</option>
                    <option value="cream" disabled={ink !== "black"}>
                      Cream
                    </option>
                  </select>
                </label>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" checked={bleed} onChange={(e) => setBleed(e.target.checked)} />
              <span>Interior bleed (for designs that print to the page edge)</span>
            </label>
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Starting interior</h2>
            <div className="field-row">
              <div className="field">
                <label>
                  Pages from
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    {GENERATORS.filter((g) => g.kind !== "title-page" && g.kind !== "belongs-to").map((g) => (
                      <option key={g.kind} value={g.kind}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {"count" in cfg && (
                <div className="field">
                  <label>
                    {kind === "sudoku" || kind === "maze" ? "Puzzles" : "Pages"}
                    <input type="number" min={0} max={800} value={count} onChange={(e) => setCount(Math.max(0, Number(e.target.value) || 0))} />
                  </label>
                </div>
              )}
            </div>
            <label className="check">
              <input type="checkbox" checked={frontMatter} onChange={(e) => setFrontMatter(e.target.checked)} /> Add a title page{isLowContent(bookType) ? " and a \"This book belongs to\" page" : ""}
            </label>
            <p className="field-hint" style={{ margin: 0 }}>
              You can add, mix and reorder page types later. Prompt journals and word searches can be filled by AI in the editor.
            </p>
          </div>
        </div>
        <aside className="stack sticky-aside">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Derived from KDP rules</h2>
            <div className="grid grid-2">
              <div className="stat">
                <span className="stat-label">Pages</span>
                <span className="stat-value">{pages}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Spine</span>
                <span className="stat-value">{spineWidthIn(spec, pages).toFixed(3)}"</span>
              </div>
              <div className="stat">
                <span className="stat-label">Cover (with bleed)</span>
                <span className="stat-sub" style={{ fontSize: 14, color: "var(--ink)" }}>
                  {round(ptToIn(cg.width))}" × {round(ptToIn(cg.height))}"
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Print cost (US)</span>
                <span className="stat-sub" style={{ fontSize: 14, color: "var(--ink)" }}>
                  ${printCostUsd(spec, Math.max(pages, 24)).toFixed(2)}
                </span>
              </div>
            </div>
            {pages < 24 && <div className="notice notice-warn">KDP needs at least 24 pages; you can add more later.</div>}
            {!cg.spineTextAllowed && <div className="notice notice-info">Under 80 pages: no spine text allowed.</div>}
            <span className="badge">{isLowContent(bookType) ? "Low-content book" : "Not low-content"}</span>
            <button className="btn btn-primary" onClick={create} disabled={busy || !isValidPaperInk(paper, ink)}>
              {busy && <span className="spinner" />} Create book
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
