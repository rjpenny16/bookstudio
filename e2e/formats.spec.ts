import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

const shots = process.env.E2E_SCREENSHOTS;

test("turn on a hardcover, check its cover against KDP, plan it, record it and export it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());

  await page.goto("/");
  await page.getByRole("link", { name: /Start from a KDP preset/ }).click();
  await page.getByLabel("Working title").fill("Formats Test Journal");
  await page.getByLabel("Book type").selectOption("journal");
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_/);

  await page.getByRole("tab", { name: "Export" }).click();
  const formats = page.locator("#formats");
  await expect(formats.getByRole("heading", { name: "Formats" })).toBeVisible();
  await expect(formats.getByLabel("Publish as Paperback")).toBeChecked();
  await formats.getByLabel("Publish as Hardcover").check();

  // Five pages is too short for a hardcover; the panel says why.
  const hardcover = page.locator("#hardcover");
  await expect(hardcover.getByText(/at least 75 pages/)).toBeVisible();

  // Add pages, then the hardcover is possible.
  await page.getByRole("tab", { name: "Interior" }).click();
  await page.getByRole("button", { name: "+ Add" }).click();
  const dialog = page.getByRole("dialog", { name: "Add pages" });
  await dialog.getByLabel("Page type").selectOption("lined");
  await dialog.getByLabel("Pages", { exact: true }).fill("115");
  await dialog.getByRole("button", { name: /^Add 115 pages$/ }).click();
  await expect(page.getByRole("listbox", { name: "Pages" }).getByRole("option")).toHaveCount(120);
  await page.getByRole("tab", { name: "Export" }).click();
  await expect(hardcover.getByText("Cover with wrap")).toBeVisible();
  await expect(hardcover.getByRole("img", { name: /Hardcover cover/ })).toBeVisible();

  // A KDP size that differs is caught, and can be adopted.
  await formats.getByLabel("List price (USD)").fill("19.99");
  await hardcover.getByLabel("KDP cover width (in)").fill("14.2");
  await hardcover.getByLabel("KDP cover height (in)").fill("10.4");
  await expect(hardcover.getByText(/off KDP/)).toBeVisible();
  await hardcover.getByRole("button", { name: /Use KDP.s cover size/ }).click();
  await expect(hardcover.getByText(/matches KDP/)).toBeVisible();
  await expect(hardcover.getByText(/14\.2" × 10\.4"/)).toBeVisible();

  await formats.getByRole("button", { name: "Next free week" }).last().click();
  await expect(formats.locator(".badge", { hasText: "Planned" })).toBeVisible();
  await formats.getByRole("button", { name: "Mark: Created on KDP" }).last().click();
  await expect(formats.locator(".badge", { hasText: "Created on KDP" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/formats.png`, fullPage: true });

  // The package has a hardcover folder with a cover the size KDP gave.
  await page.getByLabel(/I reviewed the interior/).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download .*KDP package/ }).click()]);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  for (const f of ["cover.pdf", "hardcover/cover.pdf", "hardcover/interior.pdf", "hardcover/metadata.json"]) expect(zip.file(f), f).not.toBeNull();
  const cover = await PDFDocument.load(await zip.file("hardcover/cover.pdf")!.async("uint8array"));
  expect(cover.getPage(0).getSize().width / 72).toBeCloseTo(14.2, 2);
  expect(cover.getPage(0).getSize().height / 72).toBeCloseTo(10.4, 2);
  expect(JSON.parse(await zip.file("hardcover/metadata.json")!.async("string"))).toMatchObject({ format: "hardcover", listPriceUsd: 19.99 });

  // Let autosave land, then check the planner and the projects page.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Release planner" })).toBeVisible();
  const strip = page.getByLabel("KDP weekly title allowance");
  await expect(strip).toContainText("Hardcover");
  await expect(strip.locator(".stat").nth(1)).toContainText("1 of 2 new titles left");
  // The paperback is waiting for a week; planning it moves it into this week.
  await expect(page.getByRole("row", { name: /Formats Test Journal Paperback/ })).toBeVisible();
  await page.getByRole("button", { name: "Plan all into free weeks" }).click();
  await expect(page.getByText(/Every format you.ve turned on has a week/)).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/schedule.png`, fullPage: true });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This week on KDP" })).toBeVisible();
  expect(errors).toEqual([]);
});
