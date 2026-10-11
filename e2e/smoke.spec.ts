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
  await expect(page.getByRole("option", { name: /Morning Pages Journal/ }).first()).toBeVisible();
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
