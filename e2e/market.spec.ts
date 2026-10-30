import { expect, test } from "@playwright/test";

const product = (asin: string, price: number, bsr: number) => ({ asin, title: `Sudoku Book ${asin}`, author: "Someone", bsr, price, reviews: 120, rating: 4.5, pages: 120, publishedAt: "2025-01", imageUrl: "", monthlySold: null });

const snapshot = {
  keyword: "large print sudoku",
  fetchedAt: new Date().toISOString(),
  source: "keepa + dataforseo",
  products: [product("B0AAAAAAA1", 7.99, 20000), product("B0AAAAAAA2", 8.99, 35000), product("B0AAAAAAA3", 8.99, 60000), product("B0AAAAAAA4", 9.99, 90000), product("B0AAAAAAA5", 11.99, 150000)],
  keywords: [
    { keyword: "sudoku puzzle books for adults", volume: 12100, source: "dataforseo" },
    { keyword: "brain games for seniors", volume: 6600, source: "dataforseo" },
    { keyword: "dementia activities", volume: 2400, source: "dataforseo" },
  ],
};

test("with market data, autopilot prices against competitors, fills keywords by search volume, and the book is backed up", async ({ page }) => {
  // Keywords asked for: another test's inbox idea can be built by this tab too (parallel workers share the server).
  const asked: string[] = [];
  await page.route("/api/market", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { products: { configured: true, provider: "keepa", detail: "mocked" }, keywords: { configured: true, provider: "dataforseo", detail: "mocked" } } });
    }
    asked.push(route.request().postDataJSON().keyword);
    return route.fulfill({ json: { snapshot, usage: { keepaTokens: 20, dataforseoUsd: 0.02 }, warnings: [] } });
  });

  await page.goto("/autopilot");
  await page.getByRole("button", { name: "large print sudoku" }).click();
  await page.getByRole("button", { name: "Start the book" }).click();
  await expect(page.getByText("Draft ready for your review")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("list", { name: "Conversation" }).getByText(/Market data: 5 competing books, 3 search phrases/)).toBeVisible();
  expect(asked.filter((k) => k === "large print sudoku")).toHaveLength(1);

  await page.getByRole("link", { name: "Review listing" }).click();
  // Competitors charge $7.99-$11.99 (middle $8.99-$9.99), so the price goes to $9.99 for the 60% royalty.
  await expect(page.getByLabel("List price (USD)")).toHaveValue("9.99");
  await expect(page.getByTestId("price-recommendation")).toContainText("50% to 60%");
  // The keyword slots hold the measured phrases, without repeating title words.
  const slots = await Promise.all([1, 2, 3].map((i) => page.getByLabel(new RegExp(`^Keyword ${i}\\b`)).inputValue()));
  expect(slots.join(" ")).toMatch(/brain/);
  expect(slots.join(" ")).toMatch(/dementia/);

  // The draft was copied to the server's backup folder.
  await page.goto("/settings");
  await expect(page.getByTestId("backup-card")).toContainText(/[1-9]\d* project\(s\) backed up/, { timeout: 15_000 });
  // Other tests' books may be there too (they ran in other browsers); this browser's own copy is never behind.
  await expect(page.getByTestId("backup-card")).not.toContainText("newer than this browser's copy");
});

test("settings explain market data when no provider is set up", async ({ page }) => {
  await page.goto("/settings");
  const providers = page.getByRole("list", { name: "Market data providers" });
  await expect(providers.getByRole("listitem", { name: /Competing books/ })).toContainText("KEEPA_API_KEY");
  await expect(providers.getByRole("listitem", { name: /search volumes/ }).getByRole("button", { name: "Test connection" })).toBeDisabled();
});
