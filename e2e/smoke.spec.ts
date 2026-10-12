import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

const shots = process.env.E2E_SCREENSHOTS;

test("create a book, edit it, pass preflight and export a KDP package", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your books" })).toBeVisible();

  await page.getByRole("link", { name: /Start from a KDP preset/ }).click();
  await page.getByLabel("Working title").fill("Morning Pages Journal");
  await page.getByLabel("Author / pen name").fill("Ada Writer");
  await page.getByLabel("Book type").selectOption("journal");
  await page.getByRole("button", { name: "Create book" }).click();

  await expect(page).toHaveURL(/\/projects\/prj_/);
  await expect(page.getByRole("tab", { name: "Interior" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Pages" }).getByRole("option")).toHaveCount(5);
  if (shots) await page.screenshot({ path: `${shots}/interior.png` });

  // Add 115 lined pages through the generator dialog.
  await page.getByRole("button", { name: "+ Add" }).click();
  const dialog = page.getByRole("dialog", { name: "Add pages" });
  await dialog.getByLabel("Page type").selectOption("lined");
  await dialog.getByLabel("Pages", { exact: true }).fill("115");
  await dialog.getByRole("button", { name: /^Add 115 pages$/ }).click();
  await expect(page.getByRole("listbox", { name: "Pages" }).getByRole("option")).toHaveCount(120);

  // Add a text element and edit it from the accessible properties panel.
  await page.getByRole("button", { name: "+ Text" }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Today I noticed");
  await page.getByRole("textbox", { name: "Text", exact: true }).blur();
  await expect(page.getByRole("option", { name: /Today I noticed/ })).toBeVisible();

  // Cover: rebuild from template.
  await page.getByRole("tab", { name: "Cover" }).click();
  await page.getByRole("button", { name: "Build cover from listing" }).click();
  // The title is laid out as a lockup: "Morning Pages" large, "Journal" set smaller beneath it.
  await expect(page.getByRole("option", { name: /Morning Pages/i }).first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/cover.png` });

  // Listing: fill required fields with the offline drafter, then confirm disclosure.
  await page.getByRole("tab", { name: "Listing" }).click();
  await page.getByRole("button", { name: /Draft listing with AI/ }).click();
  await expect(page.getByText(/Drafted by offline/)).toBeVisible();
  await page.getByLabel(/I have reviewed these answers/).check();
  if (shots) await page.screenshot({ path: `${shots}/listing.png`, fullPage: true });

  // Quality review: rule checks run offline, and the offline listing critique is stored.
  await page.getByRole("tab", { name: "Quality" }).click();
  await expect(page.getByRole("heading", { name: "Quality review" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Review cover & pages with AI/ })).toBeDisabled();
  await page.getByRole("button", { name: /Critique listing with AI/ }).click();
  await expect(page.getByText(/only the rule-based checks ran/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/quality.png`, fullPage: true });

  // Preflight should have no blocking issues.
  await page.getByRole("tab", { name: "Preflight" }).click();
  await expect(page.getByText("Ready for export")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/preflight.png`, fullPage: true });

  // Export the package.
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(page.getByRole("img", { name: /Paperback mockup/ })).toBeVisible();
  await page.getByLabel(/I reviewed the interior/).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download KDP package/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/morning-pages-journal-kdp\.zip/);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  for (const f of ["interior.pdf", "cover.pdf", "metadata.json", "metadata.csv", "preflight.json", "ai-provenance.json", "licenses.json", "README.txt", "project.bookstudio.json", "cover-preview.png", "mockups/paperback.png"]) {
    expect(zip.file(f), f).not.toBeNull();
  }
  const meta = JSON.parse(await zip.file("metadata.json")!.async("string"));
  expect(meta.print.pageCount).toBe(120);
  if (shots) await page.screenshot({ path: `${shots}/export.png`, fullPage: true });

  expect(errors).toEqual([]);
});

test("autopilot drafts a puzzle book offline", async ({ page }) => {
  await page.goto("/autopilot");
  await page.getByRole("button", { name: "large print sudoku" }).click();
  await page.getByRole("button", { name: "Run autopilot" }).click();
  await expect(page.getByText("Draft ready for your review")).toBeVisible({ timeout: 90_000 });
  // A complete book: difficulty sections plus front and back matter, not one repeated generator.
  const sections = page.getByRole("list", { name: "Book sections" }).getByRole("listitem");
  await expect(sections.filter({ hasText: /^Easy: \d+ pages/ })).toHaveCount(1);
  await expect(sections.filter({ hasText: /^Expert: \d+ pages/ })).toHaveCount(1);
  await expect(sections.filter({ hasText: /How to Play/ })).toHaveCount(1);
  await expect(sections.filter({ hasText: /Answer key/ })).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Quality review" }).getByRole("listitem").filter({ hasText: /^Rule checks: \d+ high/ })).toHaveCount(1);
  await expect(page.getByText("Check content for repeats & weak items")).toBeVisible();
  // The finished draft shows its cover and pages, and the cost estimate said offline runs are free.
  await expect(page.getByRole("img", { name: "Front cover (live)" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Pages so far" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByLabel("Cost estimate")).toContainText("no model calls");
  if (shots) await page.screenshot({ path: `${shots}/autopilot.png`, fullPage: true });
  await page.getByRole("link", { name: "Open in studio" }).click();
  await expect(page.getByRole("listbox", { name: "Pages" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/autopilot-studio.png` });
});

test("quality tab sends rendered cover and pages to a vision model", async ({ page }) => {
  // Stand in for a vision-capable provider; the real server runs offline in e2e.
  const sent: { task: string; input: { images?: string[] }; images?: { label: string; mediaType: string; data: string }[] }[] = [];
  await page.route("/api/ai", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { provider: "anthropic", model: "test-model", configured: true, detail: "mocked" } });
    const body = route.request().postDataJSON();
    sent.push(body);
    if (body.task !== "visual-review") return route.continue();
    return route.fulfill({
      json: {
        output: { score: 6, summary: "Readable cover; the easy grids could use bolder box lines.", thumbnailReadable: false, findings: [{ target: body.input.images[2], severity: "medium", issue: "Box lines are thin for large print.", suggestion: "Thicken the 3x3 box lines." }] },
        meta: { provider: "anthropic", model: "test-model", task: "visual-review", promptHash: "sha256:test" },
      },
    });
  });

  await page.goto("/autopilot");
  await page.getByRole("button", { name: "large print sudoku" }).click();
  await page.getByRole("button", { name: "Run autopilot" }).click();
  await expect(page.getByText("Draft ready for your review")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("link", { name: "Quality review" }).click();
  await expect(page.getByRole("tab", { name: "Quality" })).toHaveAttribute("aria-selected", "true");

  // Autopilot skipped its visual step: only this task is mocked, so the brief came back offline.
  expect(sent.filter((s) => s.task === "visual-review")).toHaveLength(0);
  await page.getByRole("button", { name: /Review cover & pages with AI/ }).click();
  await expect(page.getByText("Box lines are thin for large print.")).toBeVisible();
  expect(sent.filter((s) => s.task === "visual-review")).toHaveLength(1);

  const req = sent.filter((s) => s.task === "visual-review").at(-1)!;
  const labels = req.images!.map((i) => i.label);
  expect(labels[0]).toBe("Cover: back, spine and front");
  expect(labels[1]).toMatch(/search thumbnail/);
  expect(labels.some((l) => /\(Easy\)$/.test(l))).toBe(true);
  expect(labels.some((l) => /\(answer key\)$/.test(l))).toBe(true);
  expect(req.input.images).toEqual(labels);
  for (const img of req.images!) {
    expect(img.mediaType).toBe("image/jpeg");
    expect(Buffer.from(img.data, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
    if (shots) await import("node:fs/promises").then((fs) => fs.writeFile(`${shots}/review-${labels.indexOf(img.label)}.jpg`, Buffer.from(img.data, "base64")));
  }
  await expect(page.getByText(/couldn.t read the title on the thumbnail/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/quality-visual.png`, fullPage: true });
});

test("autopilot generates, picks and places AI cover art", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/autopilot");
  // A striped test image made in the browser stands in for the generated art.
  const art = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 768;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = `hsl(${i * 30}, 60%, ${30 + (i % 3) * 20}%)`;
      ctx.fillRect(0, i * 64, 512, 64);
    }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  const prompts: { prompt: string; widthIn: number; heightIn: number }[] = [];
  await page.route("/api/image", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { provider: "openai", model: "test-image", configured: true, detail: "mocked" } });
    prompts.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: art, mediaType: "image/jpeg", widthPx: 512, heightPx: 768, provider: "openai", model: "test-image", promptHash: `sha256:${prompts.length}` } });
  });
  await page.reload();

  await page.getByRole("button", { name: "large print sudoku" }).click();
  await expect(page.getByLabel(/Generate AI cover art/)).toBeChecked();
  await page.getByRole("button", { name: "Run autopilot" }).click();
  await expect(page.getByText("Draft ready for your review")).toBeVisible({ timeout: 90_000 });
  expect(prompts).toHaveLength(4);
  for (const p of prompts) {
    expect(p.prompt).toMatch(/no text, letters/i);
    expect(p.widthIn).toBeGreaterThan(8);
  }
  await expect(page.getByText(/Picked .+ of 4/)).toBeVisible();

  await page.getByRole("link", { name: "Open in studio" }).click();
  await page.getByRole("tab", { name: "Cover" }).click();
  const gallery = page.getByRole("list", { name: "Cover art candidates" }).getByRole("listitem");
  await expect(gallery).toHaveCount(4);
  await expect(page.getByRole("button", { name: "On cover" })).toHaveCount(1);
  // 512 px art on an 8.5" panel is upscaled, and preflight still reports its real resolution.
  await expect(page.getByText(/Cover art prints at \d+ DPI \(upscaled from/)).toBeVisible();
  await gallery.getByRole("button", { name: "Use this" }).first().click();
  await expect(page.getByRole("button", { name: "On cover" })).toHaveCount(1);
  await expect(page.getByRole("option", { name: /Cover art/ }).first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/cover-art.png` });

  await page.getByRole("tab", { name: "Listing" }).click();
  await expect(page.getByLabel(/^Images/)).toHaveValue("some");
  await page.getByRole("tab", { name: "Preflight" }).click();
  // Upscaling is only cosmetic: preflight measures the 512 px source, which is far too small for print.
  await expect(page.getByText(/Cover: image is \d+ DPI \(minimum 150/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("one-click start builds a book and the Review & Publish screen exports it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("What is the book about?").fill("large print word search");
  await page.getByLabel("Who is it for?").fill("seniors");
  // Book type and trim are inferred from the words, with the reason shown.
  const detected = page.getByLabel("Detected setup");
  await expect(detected).toContainText("Puzzle book");
  await expect(detected).toContainText('8.5" x 11"');
  await expect(detected).toContainText("large print reads best");
  await expect(page.getByLabel("Cost estimate")).toContainText("no model calls");
  await page.getByText("Advanced").click();
  await page.getByLabel("Pages", { exact: true }).fill("100");
  await page.getByLabel("Author / pen name").fill("Ada Writer");
  await expect(detected).toContainText("100 pages");
  if (shots) await page.screenshot({ path: `${shots}/home.png`, fullPage: true });
  await page.getByRole("button", { name: "Create my book" }).click();

  // Autopilot runs by itself and opens the Review & Publish screen.
  await expect(page).toHaveURL(/\/projects\/prj_\w+#review/, { timeout: 90_000 });
  await expect(page.getByRole("tab", { name: "Review & Publish" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("100 pages ·")).toBeVisible();
  await expect(page.getByRole("img", { name: "Front cover" })).toBeVisible();

  // Flip through a section.
  const sections = page.getByRole("tablist", { name: "Book sections" });
  await sections.getByRole("tab", { name: /^Warm-Up \d+$/ }).click();
  await expect(page.getByText(/^Warm-Up: 1 of \d+ · book page \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText(/^Warm-Up: 2 of \d+/)).toBeVisible();

  // Regenerate only this section, harder.
  const before = await page.getByRole("img", { name: /^Book page/ }).getAttribute("alt");
  await page.getByLabel('Feedback for the "Warm-Up"').fill("harder puzzles");
  await page.getByRole("button", { name: 'Regenerate "Warm-Up"' }).click();
  await expect(page.getByRole("status").filter({ hasText: /Difficulty: easy → medium/ })).toBeVisible();
  expect(await page.getByRole("img", { name: /^Book page/ }).getAttribute("alt")).toBe(before);
  await expect(page.getByText("100 pages ·")).toBeVisible();

  // Restyle the cover and rewrite the listing from feedback (offline heuristics).
  await page.getByLabel("Feedback for the cover").fill("more playful and bright");
  await page.getByRole("button", { name: "Regenerate cover" }).click();
  await expect(page.getByText(/Playful template, Sunny palette/)).toBeVisible();
  await page.getByLabel("Feedback for the listing").fill("less formal");
  await page.getByRole("button", { name: "Regenerate listing" }).click();
  await expect(page.getByRole("status").filter({ hasText: /title page and cover were updated|matched the current listing/ })).toBeVisible();

  // Inline listing edit, then the scorecard: disclosure first.
  await page.getByLabel("Keyword 7").fill("big print puzzle gift");
  const card = page.getByRole("list", { name: "Scorecard" });
  await expect(card.getByRole("listitem").filter({ hasText: "AI disclosure" })).toContainText("Needs your confirmation");
  await page.getByLabel(/These answers are correct/).check();
  await expect(card.getByRole("listitem").filter({ hasText: "AI disclosure" })).toContainText("Confirmed");
  await expect(page.getByText("Ready to export")).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/review.png`, fullPage: true });

  // Export from the same screen.
  await page.getByLabel(/I reviewed the cover, pages and listing/).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export KDP package/ }).click()]);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const meta = JSON.parse(await zip.file("metadata.json")!.async("string"));
  expect(meta.print.pageCount).toBe(100);
  expect(zip.file("interior.pdf")).not.toBeNull();

  // The inline edit was saved.
  await page.reload();
  await expect(page.getByLabel("Keyword 7")).toHaveValue("big print puzzle gift");
  expect(errors).toEqual([]);
});

test("cover template library: pick a design, save it and reuse it on another book", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const newBook = async (title: string, trim: string) => {
    await page.goto("/new");
    await page.getByLabel("Working title").fill(title);
    await page.getByLabel("Author / pen name").fill("Ada Writer");
    await page.getByLabel("Book type").selectOption("puzzle");
    await page.getByLabel("Trim size").selectOption(trim);
    await page.getByRole("button", { name: "Create book" }).click();
    await expect(page).toHaveURL(/\/projects\/prj_/);
    await page.getByRole("tab", { name: "Cover" }).click();
  };

  await newBook("Sudoku for Seniors", "6x9");
  await page.getByRole("button", { name: "Browse template library" }).click();
  const library = page.getByRole("dialog", { name: "Cover template library" });
  await expect(library.getByRole("img", { name: "Botanical preview" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/cover-library-grid.png` });
  await library.getByRole("tab", { name: /Large print/ }).click();
  await expect(library.getByRole("img", { name: "Large print burst preview" })).toBeVisible();
  await library.getByRole("radio", { name: "Lavender" }).click();
  await library.getByRole("button", { name: "Use Large print burst" }).click();
  await expect(library).toBeHidden();
  await expect(page.getByText("Large print burst", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /SUDOKU FOR SENIORS/ }).first()).toBeVisible();
  await page.getByLabel("Badge text").fill("Large print");
  await page.getByRole("button", { name: "Build cover from listing" }).click();
  await expect(page.getByRole("option", { name: /^Text LARGE PRINT$/ })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/cover-library-used.png` });

  // Save it to My templates.
  await page.getByRole("button", { name: "Browse template library" }).click();
  await library.getByRole("tab", { name: /My templates/ }).click();
  await library.getByLabel("Template name").fill("Seniors series");
  await library.getByRole("button", { name: "Save current cover" }).click();
  await expect(library.getByRole("status")).toContainText('Saved "Seniors series"');
  await expect(library.getByRole("img", { name: "Seniors series preview" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/cover-library.png` });
  await library.getByRole("button", { name: "Close", exact: true }).first().click();

  // A second book, another trim size, gets the same design with its own title.
  await newBook("Word Search for Seniors", "8.5x11");
  await page.getByRole("button", { name: "Browse template library" }).click();
  await library.getByRole("tab", { name: /My templates/ }).click();
  await library.getByRole("button", { name: "Apply Seniors series" }).click();
  await expect(page.getByText("Seniors series", { exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: /WORD SEARCH FOR SENIORS/ }).first()).toBeVisible();
  await expect(page.getByRole("option", { name: /SUDOKU/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("settings show capabilities and test the connection", async ({ page }) => {
  await page.goto("/settings");
  const caps = page.getByRole("list", { name: "Capabilities" });
  await expect(caps.getByRole("listitem", { name: /Writing/ })).toContainText("offline templates");
  await expect(caps.getByRole("listitem", { name: /AI cover art/ })).toContainText("off");
  await caps.getByRole("listitem", { name: /Writing/ }).getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Connected: Offline mode/ })).toBeVisible();
  await caps.getByRole("listitem", { name: /Vision/ }).getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Failed: Offline mode can't look at images/ })).toBeVisible();
  await expect(page.getByText(/never sent to or stored in this browser/)).toBeVisible();
});
