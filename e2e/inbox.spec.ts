import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// The e2e server runs from the repo root without INBOX_FILE, so it reads data/inbox.json.
const file = path.join(process.cwd(), "data", "inbox.json");

test.afterEach(async () => {
  await rm(file, { force: true });
});

test("an idea sent from the phone is built by an open tab and opens in Review & Publish", async ({ page }) => {
  test.setTimeout(240_000);
  const now = new Date().toISOString();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      items: [
        {
          id: "e2e-idea",
          text: "word search for seniors, 60 pages, no art",
          idea: { topic: "word search", audience: "seniors", pageTarget: 60, coverArt: false, notes: "" },
          status: "queued",
          createdAt: now,
          updatedAt: now,
        },
      ],
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  const card = page.getByRole("list", { name: "Ideas" }).getByRole("listitem").first();
  await expect(card.getByText("Ready to review")).toBeVisible({ timeout: 200_000 });
  await expect(card).toContainText(/preflight \d+\/\d+/);

  await card.getByRole("link", { name: "Open Review & Publish" }).click();
  await expect(page).toHaveURL(/\/projects\/prj_.*#review/);
  expect(errors).toEqual([]);
});
