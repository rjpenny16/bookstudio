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
| **Review & Publish** | One screen, opened after autopilot, with everything needed to ship: the cover and its art candidates, a page flip-through grouped by section, the listing (editable inline), a ready-to-publish scorecard out of 100 (preflight, content, cover & pages, listing, disclosure) with one-click fixes, the AI disclosure confirmation and the Export button. A "Before you export" checklist at the top says what is left (preflight, listing errors, disclosure, final approval) and its Next button takes you to that control. Each section, the cover and the listing has a **Regenerate with feedback** box ("harder puzzles", "more playful", "less formal") that reruns only that part: a section keeps its page count and answer key, a cover restyles (or gets new art when it uses AI art), and a new listing updates the title page and cover to match. Undo brings back the previous version. The other tabs stay for detailed editing. |
| **Phones and tablets** | Every screen fits a phone without sideways scrolling (an e2e test checks each one at 390 px). On small screens the navigation folds behind a Menu button, the studio shows pages as one swipeable row, fields use 16 px text so iOS doesn't zoom in, and buttons are larger for fingers. Page and cover previews render for the size and pixel density they are shown at. |
| **Project setup** | KDP paperback presets: 17 trim sizes, white/cream paper, B&W/standard/premium color, bleed. Spine width, cover size, gutter and safe zones are derived from the spec, never typed by hand. |
| **Studio** | Fabric.js canvas over a renderer-neutral document model. Text, shapes, lines, images (PNG/JPG/WebP/SVG), procedural patterns. Layers, lock, arrange, snapping, undo/redo, and live trim/bleed/gutter/spine/barcode guides. |
| **Accessibility** | Every canvas action is also available as ordinary form controls: a layer listbox, numeric X/Y/W/H in inches, a text field, and keyboard nudge, delete and duplicate. |
| **Interior generators** | Lined, dot grid, graph, handwriting, music staff, prompt journal, gratitude (with affirmations), daily planner, weekly planner, monthly calendar (dated or undated), habit tracker, custom log tables, title, "belongs to", text (how-to, intro, thank-you), section divider and table-of-contents pages, coloring pages from your art, **Sudoku** (unique solution, graded by the techniques a person needs: singles for easy, pairs and pointing for medium, triples, X-wings and XY-wings for hard, beyond those for expert; every puzzle is labelled with the grade it really has), **word search** and **number search** (every word findable exactly once; harder grids add backwards words, cross more words and use the words' own letters as decoy filler, and grow a size on every trim), **word scramble** (easy keeps the first letter; hard moves every letter; never scrambles into another word on the list), **cryptogram** (no letter maps to itself), **crosswords** (themed criss-cross grids where every answer crosses another and every run of letters is a listed answer; numbered the standard way with Across and Down clues; easy puzzles add a word bank and harder ones hold more answers in a bigger grid; clues are written by the model with the answer never in its clue, or drawn from a built-in clue bank offline) and **mazes** (perfect mazes with one solution: easy ones branch into short dead ends, hard ones wind long corridors with the longest way through; entrances and exits move along the edges). Puzzles are seeded and reproducible, have answer keys that can sit with each section or be grouped at the back, and keep their numbering across sections. |
| **Interior design** | Each book gets an interior style from its genre, so the inside matches the cover: heading and body faces (Oswald for puzzle books, Montserrat for large print, Fredoka for kids, DM Serif Display with Lora for journals, and so on) and an ornament used on the title page, contents and dividers. Large-print books set everything a reader reads at 14 pt or more, with 12 pt page numbers, wider ruling and four solved grids per answer-key page. Dividers show the part number, what the part holds ("Sudoku 21–40 · Medium") and, on the first divider of each puzzle kind, a "How to play" box. Sections are sized so every part opens on a right-hand page; when one wouldn't, an unnumbered blank page goes before it. The contents page has dotted leaders, and puzzle pages show the number and difficulty over the grid. Quality checks flag large-print pages with text under 14 pt and dividers that open on a left-hand page. |
| **Cover** | Full-wrap cover editor (back, spine, front) with 14 vector templates and 21 palettes. **Genre profiles** (puzzle, large print, kids, gratitude & wellness, faith, journal, planner, log book) pick the templates, palettes and type pairings that suit the book. Titles are set as a **lockup**: the word shoppers search for ("SUDOKU", "Gratitude") large, a qualifier above ("LARGE PRINT") and the format and reader below ("Puzzles for Seniors"), sized from the fonts' real metrics with balanced line breaks. The back cover has a hook line, the full blurb (shortened only by whole sentences), "What's inside" as checked items on a tinted panel and page thumbnails; the spine sets the title and author separately. Text can carry letter spacing and an outline, drawn the same on screen and in the PDF. Front-cover elements stay anchored when the page count changes the spine width. **Cover design search:** autopilot lays the title out in several of the genre's templates and palettes, scores each front on its rendered pixels (every text's contrast against what is actually behind it, art included; the title's size in a 160 px search thumbnail; how busy the background is; balance) plus genre fit, and a vision model picks from the best three (offline, the best score wins). If the visual review then says the cover fails, it is redesigned once and the better-reviewed version kept. Review & Publish shows the runners-up under **Other designs**, one click each. Puzzle covers show a piece of the book's own first sudoku or word search. |
| **Cover template library** | A gallery in the Cover tab that previews every design with the book's own title in any palette, filed on shelves (puzzle & activity, journal & notebook, planner & log book, kids, large print & seniors, series, classic, modern, with cover art). Designs include color-block mosaics, botanical flowers, a spiral-bound look, a large-print starburst, a numbered series ribbon, a kids' sticker title, rainbow arcs and a vintage label, all vector and print-safe. Some carry a badge ("150 puzzles", "Large print") that defaults from the book. **My templates** saves any finished cover (including its art and logos) and applies it to another book: the layout is resized to that book's trim and spine, the title, subtitle, author, series volume and badge are swapped in, and the back cover and spine are rebuilt, so a whole series shares one look. Templates can be downloaded as files and imported elsewhere. |
| **AI cover art** | With `OPENAI_API_KEY` set, or `IMAGE_PROVIDER=codex` to use a ChatGPT subscription: an art-direction task writes several distinct image prompts (with fixed rules: no text, logos or characters in the art, a calm area for the title, a print-friendly style), the OpenAI Images API generates candidates, and you pick one from a gallery, or a vision model picks the one shoppers are most likely to click. Three art layouts (full bleed, art panel, framed art) set the title on a plate whose color is checked against the measured tone of the art behind it. gpt-image-2 is asked for art at 300 DPI for the cover size; older fixed-size models are cropped and upscaled, and preflight still reports the real resolution. Generated art is marked AI-generated with a license record, so the KDP image disclosure is pre-filled. Art is prompted in the genre's style; full-bleed art is cropped so its calmest part sits under the title, which sits on a soft fade of the palette color rather than a box; art with lettering in it is passed over (one more image is generated if every candidate has some); and the variant search also tries a palette taken from the art's own colors. |
| **AI** | Brief, listing copy, journal prompts, word lists and keyword clusters, with schema-validated output. Prompts spell out what good content looks like (open, concrete, varied prompts; sub-themed word lists matched to the reader; original cryptogram sayings) and pass an `avoid` list so new content never repeats the book. Long sections are written in batches of about 30, each told what earlier batches said, and a review step flags weak items (yes/no or vague prompts, crowded openings, anything the model's editor pass names) and rewrites them. Gratitude journals get one affirmation per page. Providers: **Claude** (Anthropic SDK), **ChatGPT** through the codex CLI on your subscription (`AI_PROVIDER=codex`), **Ollama** (self-hosted open-weight models), or **offline** heuristics with large hand-written banks, so the app works with no keys. Offline prompts and affirmations are matched to the reader (nurses, teachers, parents, travelers, faith, wellness and more) and to each section's focus (looking back, right now, looking ahead). |
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
| `codex` | the [codex CLI](https://github.com/openai/codex) logged in with your ChatGPT account | Uses your **ChatGPT subscription** instead of an API key, the same setup as `IMAGE_PROVIDER=codex` below: `npm install -g @openai/codex`, then `codex login`. Every writing and review task (brief, plan, prompts, word lists, clues, listing, critiques, visual review, art direction and picks) runs through `codex exec` in a read-only sandbox; images for vision tasks are attached to the request. The JSON schema goes in the prompt and the reply is validated, with one retry. Not billed per call, but slower than an API (an autopilot run makes about 6 to 40 calls) and counts toward your ChatGPT usage limits. `CODEX_TEXT_MODEL` picks a model; otherwise codex uses its default. Set it together with `IMAGE_PROVIDER=codex` to make whole books, text and cover art, on the subscription. |
| `ollama` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Any local model with JSON-schema output (e.g. a Qwen-family model). Check the model's license yourself. |
| `offline` | nothing | Deterministic templates. Nothing is marked AI-generated because no model was used. |

Cover art is separate from the text provider and optional:

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | Enables AI cover art through the OpenAI Images API. Without it, covers use the vector templates. |
| `OPENAI_IMAGE_MODEL` | Default `gpt-image-2` (free-form sizes, so art is requested at 300 DPI up to its 8.3 MP limit). `gpt-image-1` and `gpt-image-1.5` work at their fixed sizes and get upscaled. |
| `OPENAI_IMAGE_QUALITY` | `low`, `medium` or `high` (default). Each candidate is a separate paid request; autopilot generates 4. |
| `IMAGE_PROVIDER=codex` | Uses your **ChatGPT subscription** instead of an API key: the server runs the [codex CLI](https://github.com/openai/codex) through the bundled [gpt-image-bridge](https://github.com/oakplank/gpt-image-bridge) script (`.claude/skills/gpt-image-bridge`). Install codex where the app runs (`npm install -g @openai/codex`) and run `codex login` with your ChatGPT account. No per-image billing, but each image takes about 2 to 6 minutes and counts toward your ChatGPT usage limits. Takes precedence over `OPENAI_API_KEY`. Run the app with `npm run dev` or `npm start` on that machine; the Docker image doesn't include codex or bash. On Windows the bridge runs in Git for Windows' bash (found under Program Files automatically). Use **Test** next to AI cover art in Settings to check the setup without generating an image. |
| `CODEX_BASH` | Optional path to the bash that runs the bridge, if Git for Windows is installed somewhere unusual. |
| `CODEX_IMAGE_BRIDGE` | Optional path to the bridge script, if it isn't at `.claude/skills/gpt-image-bridge/bin/gpt-image-2`. |

The same bridge is a Claude Code skill: working in this repo, ask Claude Code for an image (a cover concept, spot art for an interior page) and it generates one through codex and your subscription.

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
│   ├── quality/       Content, design and listing checks; puzzle measurements; listing critique and visual review runners
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

### Fonts

Fonts live in `public/fonts` (SIL OFL; copyright lines in `OFL.txt`) and are registered in `src/lib/render/fonts.ts`. Cover layout measures text with a table of the fonts' advance widths, so after adding or changing a font run `npm run font-metrics` to regenerate `src/lib/render/fontMetricsData.ts` (a test fails while it is stale). Every font must embed in full with pdf-lib; `tests/fonts.test.ts` checks that.

### Sample books (quality baseline)

```bash
npm run build
npm run samples        # about a minute; writes to samples/ (git-ignored), or set SAMPLES_OUT
```

Builds six reference books through the real one-click start with the offline provider: large-print sudoku for seniors, a kids' activity book, a word-search book, a gratitude journal, a weekly planner and a log book. Randomness and the clock are fixed, so two runs give the same books. For each book you get `interior.pdf`, `cover.pdf`, `cover-front.png`, `cover-thumb.png` (160 px tall, as in Amazon search results), `cover-wrap.png`, `spreads.png` (the opening, the first spread of each section, the answer key and the end) and `report.json`. The report holds the scorecard, preflight problems, quality findings, repeated text and puzzle measurements: sudoku clue counts against the difficulty label, word-search direction mix and words that can be read twice, maze path length and dead ends. `samples/summary.md` compares the books in one table, and `samples/index.html` shows every cover and spread on one page. Run it before and after a change to see what improved. `SAMPLES_ART=mock npm run samples` builds the same books with synthetic artwork in place of the image provider (no key needed) into `samples/art`, to check the art layouts, crop and title fade.

## Roadmap

These are features the blueprint calls for that are not in v0.1:

- Hardcover and ebook formats, plus non-US marketplaces' printing costs
- More image providers (FLUX/ComfyUI) and a dedicated upscaler behind the same `ImageProvider` interface, plus automatic line-art cleanup for coloring pages
- PDF/SVG import with OCR layout recovery (PaddleOCR worker)
- Server-side projects, accounts and team roles (Keycloak/OIDC), real-time collaboration
- Durable server workflows (Temporal) for very large batch generation
- More puzzle engines (kakuro, nonograms), page masters/variables, text-on-path, masks
- Plugin SDK for research providers, exporters and preflight rules
- RAG over versioned KDP help pages for policy answers with citations

## License

Code: [Apache-2.0](LICENSE). Bundled fonts: SIL Open Font License 1.1 ([`public/fonts/OFL.txt`](public/fonts/OFL.txt)). Model weights and third-party data keep their own licenses. "Amazon" and "KDP" are trademarks of Amazon.com, Inc. BookStudio is not affiliated with or endorsed by Amazon or any other publishing-tool vendor.
