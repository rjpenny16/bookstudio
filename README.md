# BookStudio

An open-source, AI-automated publishing studio for Amazon KDP print books: journals, planners, notebooks, log books, and puzzle and activity books.

BookStudio follows the "OpenPublisher" blueprint. It is not a clone of any commercial tool. It is a **publishing compiler**: a brief becomes a structured book specification, AI proposes content, deterministic engines lay it out, a versioned KDP rule set checks it, and you get a validated package ready to upload. Every step is inspectable, editable, and logged.

```
Brief ──► Interior generators ──► Cover templates ──► Listing ──► KDP preflight ──► Human approval ──► KDP package (.zip)
  ▲            (code-verified)       (editable)       (AI draft)    (+ auto-repair)                      interior.pdf, cover.pdf,
  └── Research boards (your own data, estimates labelled)                                               metadata, provenance…
```

## What's in v0.1

| Area | What you get |
|---|---|
| **Project setup** | KDP paperback presets: 17 trim sizes, white/cream paper, B&W/standard/premium color, bleed. Spine width, cover size, gutter and safe zones are derived from the spec, never typed by hand. |
| **Studio** | Fabric.js canvas over a renderer-neutral document model. Text, shapes, lines, images (PNG/JPG/WebP/SVG), procedural patterns. Layers, lock, arrange, snapping, undo/redo, and live trim/bleed/gutter/spine/barcode guides. |
| **Accessibility** | Every canvas action is also available as ordinary form controls: a layer listbox, numeric X/Y/W/H in inches, a text field, and keyboard nudge, delete and duplicate. |
| **Interior generators** | Lined, dot grid, graph, handwriting, music staff, prompt journal, gratitude, daily planner, habit tracker, custom log tables, title and "belongs to" pages, coloring pages from your art, **Sudoku** (unique solution, verified), **word search** (every word verified), and **mazes** (perfect mazes, BFS solution). All of them are seeded and reproducible, and all have answer keys. |
| **Cover** | Full-wrap cover editor (back, spine, front) with six templates and eight palettes. Front-cover elements stay anchored when the page count changes the spine width. |
| **AI** | Brief, listing copy, journal prompts, word lists and keyword clusters, with schema-validated output. Providers: **Claude** (Anthropic SDK), **Ollama** (self-hosted open-weight models), or **offline** heuristics, so the app works with no keys. |
| **Autopilot agent** | Topic → brief → interior → listing → cover → preflight with auto-repair → provenance. It stops at a human checkpoint and never publishes. |
| **KDP preflight** | 12 continuous checks: trim/paper, page count, gutter-aware margins, bleed, blank-page runs, image DPI, font embedding, cover safe zones, spine text (80+ pages), barcode area, listing limits and prohibited terms, low-content ISBN rules, and AI disclosure. One-click fixes can all be undone. |
| **Listing** | Title/subtitle/description with character counters, 7 keyword slots, 3 categories, royalty calculator (60%/50% threshold), ISBN options, and AI disclosure questions pre-filled from provenance. |
| **Export** | One zip containing `interior.pdf` and `cover.pdf` (vector, fonts embedded), `metadata.json/.csv`, `keywords.csv`, `preflight.json/.html`, `ai-provenance.json`, `licenses.json`, a cover preview, a 3D-style mockup, the portable project file, and a `README.txt` with step-by-step KDP upload instructions. |
| **Research** | Boards that import CSV data you are allowed to use. They show observed BSR, price and reviews next to **labelled estimates** (with method, 95% interval and confidence), niche opportunity scoring with its reasoning, recurring title phrases, and AI keyword clusters. There is no scraping. |
| **Measure** | Import your KDP royalty reports (CSV). Shows units and royalties by month and by title, linked back to projects. |
| **Calculators** | Cover/spine, interior margins, printing cost, and royalty. They read the same rule set as the editor, preflight and agent. |

## Quick start

```bash
npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

Or with Docker:

```bash
docker compose up --build    # http://localhost:3000
```

Projects, research boards and sales imports are stored **in your browser** (IndexedDB). Export them from **Settings** or from a project's **Export** tab. Only AI requests reach the server.

### AI providers

| `AI_PROVIDER` | Needs | Notes |
|---|---|---|
| `anthropic` (default when a key is present) | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | Claude via the official Anthropic SDK. Default model `claude-opus-5-5` (override with `ANTHROPIC_MODEL`). Uses structured outputs and server-side refusal fallback. |
| `ollama` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Any local model with JSON-schema output (e.g. a Qwen-family model). Check the model's license yourself. |
| `offline` | nothing | Deterministic templates. Nothing is marked AI-generated because no model was used. |

## KDP boundaries (by design)

- **No KDP credentials, no auto-publishing.** KDP has no public API for third-party publishing. BookStudio produces a validated package and the instructions; you upload it, check the Print Previewer and press Publish.
- **AI disclosure is enforced.** KDP requires disclosing AI-generated text, images and translations. Every element and listing field carries provenance, and preflight blocks export until you confirm the answers.
- **No scraped data.** Research works on data you import. Sales and search-volume numbers that come from a model are always shown as estimates with intervals.
- **Rules are versioned.** All KDP numbers live in [`src/lib/kdp/rules.ts`](src/lib/kdp/rules.ts) (`kdp-paperback-2026.10`). Values that KDP changes often (printing costs, page limits) are marked for verification. Confirm them on KDP before pricing.

## Architecture

```
src/
├── lib/
│   ├── schema/        Renderer-neutral project model (points, top-left origin), factories, rescaling
│   ├── kdp/           Versioned rule set + geometry (spine, cover, gutter, safe areas, royalty)
│   ├── generators/    Seeded page generators, sudoku / word search / maze engines
│   ├── cover/         Cover templates, palettes, spine-aware reflow
│   ├── render/        pdf-lib print renderer, canvas preview renderer, shared text layout & patterns
│   ├── preflight/     Checks, AI-usage detection from provenance, deterministic fixes
│   ├── ai/            Task schemas & prompts, providers (Anthropic / Ollama / offline), browser client
│   ├── agent/         Autopilot workflow (model calls inside a deterministic pipeline)
│   ├── export/        KDP package builder (zip), metadata/provenance/license manifests
│   ├── research/      CSV import, rank→sales estimates with intervals, niche scoring, sales reports
│   └── storage/       IndexedDB persistence, zustand store with undo/redo and cover reflow
├── components/        Fabric.js editor, properties/layers panel, workspace tabs
└── app/               Next.js routes + /api/ai
```

Key design decisions from the blueprint:

1. **The document model is the source of truth.** Fabric.js and pdf-lib are both renderers of it. Text layout mirrors Fabric's metrics, and patterns expand through one shared function, so the canvas and the PDF agree.
2. **The AI never drives the UI.** Models return schema-validated JSON, and deterministic domain operations build the book. Puzzles are generated and verified by code, not by the model.
3. **One rule set.** The editor guides, preflight, calculators, generators and agent all import `kdp/rules.ts`.
4. **Portable projects.** `project.bookstudio.json` (schema 1.0) contains everything, including assets and provenance.

## Development

```bash
npm run typecheck
npm run lint
npm test               # unit tests: KDP math, puzzles, preflight + fixes, PDF rendering
npm run build
npx playwright test    # end-to-end: create → edit → preflight → export; autopilot
```

The e2e suite starts the production server itself (`npm start`), so run `npm run build` first. If your Playwright version doesn't match a locally installed Chromium, set `PW_CHROMIUM_PATH` to the browser executable.

## Roadmap

These are features the blueprint calls for that are not in v0.1:

- Hardcover and ebook formats, plus non-US marketplaces' printing costs
- AI image generation (FLUX/ComfyUI provider) with automatic line-art cleanup
- PDF/SVG import with OCR layout recovery (PaddleOCR worker)
- Server-side projects, accounts and team roles (Keycloak/OIDC), real-time collaboration
- Durable server workflows (Temporal) for very large batch generation
- Crossword and other puzzle engines, page masters/variables, text-on-path, masks
- Plugin SDK for research providers, exporters and preflight rules
- RAG over versioned KDP help pages for policy answers with citations

## License

Code: [Apache-2.0](LICENSE). Bundled fonts: SIL Open Font License 1.1 ([`public/fonts/OFL.txt`](public/fonts/OFL.txt)). Model weights and third-party data keep their own licenses. "Amazon" and "KDP" are trademarks of Amazon.com, Inc. BookStudio is not affiliated with or endorsed by Amazon or any other publishing-tool vendor.
