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
| **One-screen start** | The home page asks for a niche and a reader. Book type and trim size are inferred from the words (and shown with the reason); page count and cover style are left to the brief. An Advanced section overrides any of them. Before the run you see an estimate of the model calls, tokens and images it will use. |
| **Live build** | While autopilot runs, page thumbnails appear as soon as the interior is laid out, then the front cover once it is designed. |
| **Review & Publish** | One screen, opened after autopilot, with everything needed to ship: the cover and its art candidates, a page flip-through grouped by section, the listing (editable inline), a ready-to-publish scorecard out of 100 (preflight, content, cover & pages, listing, disclosure) with one-click fixes, the AI disclosure confirmation and the Export button. Each section, the cover and the listing has a **Regenerate with feedback** box ("harder puzzles", "more playful", "less formal") that reruns only that part: a section keeps its page count and answer key, a cover restyles (or gets new art when it uses AI art), and a new listing updates the title page and cover to match. Undo brings back the previous version. The other tabs stay for detailed editing. |
| **Project setup** | KDP paperback presets: 17 trim sizes, white/cream paper, B&W/standard/premium color, bleed. Spine width, cover size, gutter and safe zones are derived from the spec, never typed by hand. |
| **Studio** | Fabric.js canvas over a renderer-neutral document model. Text, shapes, lines, images (PNG/JPG/WebP/SVG), procedural patterns. Layers, lock, arrange, snapping, undo/redo, and live trim/bleed/gutter/spine/barcode guides. |
| **Accessibility** | Every canvas action is also available as ordinary form controls: a layer listbox, numeric X/Y/W/H in inches, a text field, and keyboard nudge, delete and duplicate. |
| **Interior generators** | Lined, dot grid, graph, handwriting, music staff, prompt journal, gratitude (with affirmations), daily planner, weekly planner, monthly calendar (dated or undated), habit tracker, custom log tables, title, "belongs to", text (how-to, intro, thank-you), section divider and table-of-contents pages, coloring pages from your art, **Sudoku** (unique solution, verified), **word search** and **number search** (every entry verified), **word scramble**, **cryptogram** (no letter maps to itself) and **mazes** (perfect mazes, BFS solution). Puzzles are seeded and reproducible, have answer keys that can sit with each section or be grouped at the back, and keep their numbering across sections. |
| **Cover** | Full-wrap cover editor (back, spine, front) with six vector templates and eight palettes. Front-cover elements stay anchored when the page count changes the spine width. The back cover can carry a "What's inside" list built from the book's sections and thumbnails of real interior pages. |
| **AI cover art** | With `OPENAI_API_KEY` set: an art-direction task writes several distinct image prompts (with fixed rules: no text, logos or characters in the art, a calm area for the title, a print-friendly style), the OpenAI Images API generates candidates, and you pick one from a gallery, or a vision model picks the one shoppers are most likely to click. Three art layouts (full bleed, art panel, framed art) set the title on a plate whose color is checked against the measured tone of the art behind it. gpt-image-2 is asked for art at 300 DPI for the cover size; older fixed-size models are cropped and upscaled, and preflight still reports the real resolution. Generated art is marked AI-generated with a license record, so the KDP image disclosure is pre-filled. |
| **AI** | Brief, listing copy, journal prompts, word lists and keyword clusters, with schema-validated output. Prompts spell out what good content looks like (open, concrete, varied prompts; sub-themed word lists matched to the reader; original cryptogram sayings) and pass an `avoid` list so new content never repeats the book. Providers: **Claude** (Anthropic SDK), **Ollama** (self-hosted open-weight models), or **offline** heuristics with large hand-written banks, so the app works with no keys. |
| **Quality review** | A Quality tab with three parts. **Content:** finds repeated or reworded prompts (within and across sections), weak prompts, word lists with plurals, hidden words (SUN in SUNFLOWER), unusable or unfriendly words, repeated puzzles, and attributed quotations in cryptograms. **Listing:** rule checks for keyword stuffing, vague descriptions and unused keyword slots, plus a Claude critique that scores the listing and proposes a revision you can apply in one click. Categories come from a versioned list of real Amazon Books categories ([`src/lib/kdp/categories.ts`](src/lib/kdp/categories.ts)). **Cover & pages:** rule checks for title contrast and thumbnail legibility, plus a Claude visual review of the rendered cover, a 160 px thumbnail and sample pages. Nothing here blocks export. |
| **Autopilot agent** | Topic → brief → **section plan** → section content → **content check** (repeats and weak items replaced) → interior → listing → **listing critique** (revision applied when clearly better) → **cover art** (concepts, candidates, pick) → cover → **visual review** → preflight with auto-repair → provenance. The plan builds a complete book rather than one repeated page type: a how-to page, a contents page, difficulty-ramped puzzle sections or themed journal sections, an answer key at the back and a closing page, sized to an exact, even page count. Built-in genre recipes cover offline use and fall in when a model's plan doesn't fit the book type. It stops at a human checkpoint and never publishes. |
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

**Settings** shows which capabilities are active (writing, vision review, cover art) and has a **Test connection** button for each. The tests make one tiny request; the cover art test only looks up the image model and generates nothing. Keys stay in the server's environment variables and never reach the browser.

Projects, research boards and sales imports are stored **in your browser** (IndexedDB). Export them from **Settings** or from a project's **Export** tab. Only AI requests reach the server.

### AI providers

| `AI_PROVIDER` | Needs | Notes |
|---|---|---|
| `anthropic` (default when a key is present) | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | Claude via the official Anthropic SDK. Default model `claude-opus-5-5` (override with `ANTHROPIC_MODEL`). Uses structured outputs and server-side refusal fallback. |
| `ollama` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Any local model with JSON-schema output (e.g. a Qwen-family model). Check the model's license yourself. |
| `offline` | nothing | Deterministic templates. Nothing is marked AI-generated because no model was used. |

Cover art is separate from the text provider and optional:

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | Enables AI cover art through the OpenAI Images API. Without it, covers use the vector templates. |
| `OPENAI_IMAGE_MODEL` | Default `gpt-image-2` (free-form sizes, so art is requested at 300 DPI up to its 8.3 MP limit). `gpt-image-1` and `gpt-image-1.5` work at their fixed sizes and get upscaled. |
| `OPENAI_IMAGE_QUALITY` | `low`, `medium` or `high` (default). Each candidate is a separate paid request; autopilot generates 4. |

## KDP boundaries (by design)

- **No KDP credentials, no auto-publishing.** KDP has no public API for third-party publishing. BookStudio produces a validated package and the instructions; you upload it, check the Print Previewer and press Publish.
- **AI disclosure is enforced.** KDP requires disclosing AI-generated text, images and translations. Every element and listing field carries provenance, and preflight blocks export until you confirm the answers.
- **No scraped data.** Research works on data you import. Sales and search-volume numbers that come from a model are always shown as estimates with intervals.
- **Rules are versioned.** All KDP numbers live in [`src/lib/kdp/rules.ts`](src/lib/kdp/rules.ts) (`kdp-paperback-2026.10`). Values that KDP changes often (printing costs, page limits) are marked for verification. Confirm them on KDP before pricing. The category list (`amazon-books-2026.10`) follows the same policy: confirm each path in KDP's category picker.

## Architecture

```
src/
├── lib/
│   ├── schema/        Renderer-neutral project model (points, top-left origin), factories, rescaling
│   ├── kdp/           Versioned rule set + geometry (spine, cover, gutter, safe areas, royalty) + Amazon Books categories
│   ├── generators/    Seeded page generators, sudoku / word search / maze engines
│   ├── cover/         Cover templates, palettes, spine-aware reflow
│   ├── render/        pdf-lib print renderer, canvas preview renderer, shared text layout & patterns
│   ├── preflight/     Checks, AI-usage detection from provenance, deterministic fixes
│   ├── ai/            Task schemas & prompts, providers (Anthropic / Ollama / offline), browser client
│   ├── agent/         Autopilot workflow (model calls inside a deterministic pipeline), setup inference, run estimate, regenerate-with-feedback
│   ├── export/        KDP package builder (zip), metadata/provenance/license manifests
│   ├── research/      CSV import, rank→sales estimates with intervals, niche scoring, sales reports
│   └── storage/       IndexedDB persistence, zustand store with undo/redo and cover reflow
│   ├── quality/       Content, design and listing checks; listing critique and visual review runners
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
npm test               # unit tests: KDP math, puzzles, preflight + fixes, PDF rendering, quality checks
npm run build
npx playwright test    # end-to-end: create → edit → quality → preflight → export; one-click start → Review & Publish → regenerate → export; autopilot; visual review and cover art (mocked); settings
```

The e2e suite starts the production server itself (`npm start`), so run `npm run build` first. If your Playwright version doesn't match a locally installed Chromium, set `PW_CHROMIUM_PATH` to the browser executable.

## Roadmap

These are features the blueprint calls for that are not in v0.1:

- Hardcover and ebook formats, plus non-US marketplaces' printing costs
- More image providers (FLUX/ComfyUI) and a dedicated upscaler behind the same `ImageProvider` interface, plus automatic line-art cleanup for coloring pages
- PDF/SVG import with OCR layout recovery (PaddleOCR worker)
- Server-side projects, accounts and team roles (Keycloak/OIDC), real-time collaboration
- Durable server workflows (Temporal) for very large batch generation
- Crossword and other puzzle engines, page masters/variables, text-on-path, masks
- Plugin SDK for research providers, exporters and preflight rules
- RAG over versioned KDP help pages for policy answers with citations

## License

Code: [Apache-2.0](LICENSE). Bundled fonts: SIL Open Font License 1.1 ([`public/fonts/OFL.txt`](public/fonts/OFL.txt)). Model weights and third-party data keep their own licenses. "Amazon" and "KDP" are trademarks of Amazon.com, Inc. BookStudio is not affiliated with or endorsed by Amazon or any other publishing-tool vendor.
