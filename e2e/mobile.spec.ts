import { expect, test, type Page } from "@playwright/test";

/** A phone-sized screen: nothing may scroll sideways, and the main flow must work with taps. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const overflow = (page: Page) => page.evaluate(() => document.scrollingElement!.scrollWidth - document.documentElement.clientWidth);

test("every screen fits a phone, and a book can be made and reviewed there", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  for (const path of ["/", "/new", "/autopilot", "/research", "/tools", "/sales", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }

  // The links fold behind a menu button and close after a choice.
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Settings" })).toBeHidden();
  await nav.getByRole("button", { name: "Menu" }).click();
  await expect(nav.getByRole("button", { name: "Close" })).toHaveAttribute("aria-expanded", "true");
  await nav.getByRole("link", { name: "KDP calculators" }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(nav.getByRole("link", { name: "Settings" })).toBeHidden();

  // Make a book from the home screen. Its fields are 16px so iOS doesn't zoom in on them.
  await page.goto("/");
  const about = page.getByLabel("What is the book about?");
  expect(await about.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await about.fill("large print word search");
  await page.getByLabel("Who is it for?").fill("seniors");
  await page.getByRole("button", { name: "Create my book" }).click();
  await expect(page).toHaveURL(/#review/, { timeout: 90_000 });
  await expect(page.getByRole("img", { name: "Front cover" })).toBeVisible();
  expect(await overflow(page), "review").toBeLessThanOrEqual(0);

  // The checklist says what to do next and takes you there.
  const list = page.getByRole("list", { name: "Export checklist" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await page.getByRole("button", { name: "Next: Confirm the AI disclosure" }).click();
  await expect(page.locator("#confirm-disclosure")).toBeFocused();
  await page.locator("#confirm-disclosure").check();
  await page.getByRole("button", { name: "Next: Approve the final book" }).click();
  await expect(page.locator("#approve-export")).toBeFocused();
  await page.locator("#approve-export").check();
  await expect(page.getByRole("button", { name: "Ready: export the package" })).toBeVisible();

  // Every workspace tab fits too; the studio's pages are one swipeable row, not a column as long as the book.
  for (const tab of ["Brief", "Interior", "Cover", "Listing", "Quality", "Preflight", "Export"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    expect(await overflow(page), tab).toBeLessThanOrEqual(0);
    if (tab === "Interior") {
      const pages = page.getByRole("listbox", { name: "Pages" });
      const box = (await pages.boundingBox())!;
      expect(box.height).toBeLessThan(200);
      expect(await pages.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test("previews are rendered for the size they are shown at", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await page.getByLabel("What is the book about?").fill("large print sudoku");
  await page.getByLabel("Who is it for?").fill("seniors");
  await page.getByRole("button", { name: "Create my book" }).click();
  await expect(page).toHaveURL(/#review/, { timeout: 90_000 });
  // The large page preview isn't the small strip thumbnail stretched up.
  const big = page.getByRole("img", { name: /^Book page/ });
  await expect(big).toBeVisible();
  const { natural, shown } = await big.evaluate((img: HTMLImageElement) => ({ natural: img.naturalWidth, shown: img.getBoundingClientRect().width }));
  expect(natural).toBeGreaterThanOrEqual(Math.floor(shown));
});
