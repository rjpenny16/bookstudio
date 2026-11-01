import { expect, test } from "@playwright/test";

const shots = process.env.E2E_SCREENSHOTS;

test("turn on a hardcover, plan it into a week and record it on KDP", async ({ page }) => {
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
  await expect(formats.getByText(/can.t build hardcover files yet/)).toBeVisible();
  await formats.getByRole("button", { name: "Next free week" }).last().click();
  await expect(formats.locator(".badge", { hasText: "Planned" })).toBeVisible();
  await formats.getByRole("button", { name: "Mark: Created on KDP" }).last().click();
  await expect(formats.locator(".badge", { hasText: "Created on KDP" })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/formats.png`, fullPage: true });

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
