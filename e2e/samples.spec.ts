import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCoverPdf, renderInteriorPdf } from "@/lib/render/pdf";
import type { Project } from "@/lib/schema/project";
import { nodeFontLoader } from "../tests/helpers";
import type { SampleImages, Spread } from "./samples/render";
import { indexHtml, pickSpreads, sampleReport, SAMPLE_BOOKS, summaryMarkdown, type SampleReport } from "./samples/report";

/**
 * The quality baseline: builds the reference books through the real one-click
 * start (offline provider), then writes each book's PDFs, cover and spread
 * images and a scored report, plus a summary across books. Run it with
 * `npm run samples` before and after a change and compare the output.
 */

/** SAMPLES_ART=mock stands in synthetic artwork for the image provider, so the art layouts, crop and scrim are covered without a key. */
const MOCK_ART = process.env.SAMPLES_ART === "mock";
const OUT = path.resolve(process.env.SAMPLES_OUT ?? (MOCK_ART ? "samples/art" : "samples"));
const FIXED_NOW = new Date("2026-01-05T09:00:00Z");

test.describe.configure({ mode: "serial" });
test.skip(!process.env.SAMPLES, "Set SAMPLES=1 (npm run samples) to build the sample books");

let renderer = "";
let mockArt: string[] = [];
const reports: SampleReport[] = [];

/** Portrait scenes taller than a cover: a calm sky over busy ground, and busy ground over a calm sea, so the crop has a choice. */
function drawMockArt(): string[] {
  const scene = (calmTop: boolean, hue: number) => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 1792;
    const ctx = c.getContext("2d")!;
    const calm = ctx.createLinearGradient(0, 0, 0, c.height);
    calm.addColorStop(0, `hsl(${hue}, 55%, 78%)`);
    calm.addColorStop(1, `hsl(${hue}, 45%, 60%)`);
    ctx.fillStyle = calm;
    ctx.fillRect(0, 0, c.width, c.height);
    let seed = hue + 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const busyFrom = calmTop ? c.height * 0.5 : 0;
    const busyTo = calmTop ? c.height : c.height * 0.5;
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `hsl(${(hue + rnd() * 160) % 360}, 65%, ${25 + rnd() * 50}%)`;
      ctx.beginPath();
      ctx.arc(rnd() * c.width, busyFrom + rnd() * (busyTo - busyFrom), 6 + rnd() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  };
  return [scene(true, 200), scene(false, 30), scene(true, 120), scene(false, 280)];
}

test.beforeAll(async ({ browser }) => {
  if (MOCK_ART) {
    const page = await browser.newPage();
    mockArt = await page.evaluate(drawMockArt);
    await page.close();
  }
  const bundle = await build({
    entryPoints: [path.resolve("e2e/samples/render.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    tsconfig: path.resolve("tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  renderer = bundle.outputFiles[0].text;
  await mkdir(OUT, { recursive: true });
});

/** Seed Math.random so the planned sections and puzzle seeds repeat from run to run. */
function seedRandom(page: Page, seed: number) {
  return page.addInitScript((s: number) => {
    let a = s >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, seed);
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function readProject(page: Page, id: string): Promise<Project> {
  return page.evaluate(
    (key) =>
      new Promise<Project>((resolve, reject) => {
        const open = indexedDB.open("bookstudio");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction("kv").objectStore("kv").get(key);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => resolve(get.result as Project);
        };
      }),
    `project:${id}`,
  );
}

const png = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

for (const book of SAMPLE_BOOKS) {
  test(`sample: ${book.id}`, async ({ page }) => {
    test.setTimeout(300_000);
    await seedRandom(page, hash(book.id));
    if (MOCK_ART) {
      let n = 0;
      await page.route("/api/image", async (route) => {
        if (route.request().method() === "GET") return route.fulfill({ json: { provider: "openai", model: "mock-art", configured: true, detail: "mocked" } });
        const data = mockArt[n++ % mockArt.length];
        return route.fulfill({ json: { data, mediaType: "image/jpeg", widthPx: 1024, heightPx: 1792, provider: "openai", model: "mock-art", promptHash: `sha256:mock${n}` } });
      });
    }
    await page.clock.setFixedTime(FIXED_NOW);
    const params = new URLSearchParams({
      topic: book.topic,
      audience: book.audience,
      bookType: book.bookType,
      trimId: book.trimId,
      pageTarget: String(book.pageTarget),
      author: "R.P. Paper Co.",
      coverArt: MOCK_ART ? "1" : "0",
      go: "1",
    });
    await page.goto(`/autopilot?${params}`);
    await page.waitForURL(/\/projects\/[^/#]+/, { timeout: 240_000 });
    const id = new URL(page.url()).pathname.split("/").pop()!;
    // The workspace has loaded the project, so its fonts and styles are on the page too.
    await expect(page.getByRole("tab", { name: "Review & Publish" })).toBeVisible();
    const project = await readProject(page, id);
    expect(project?.interior.pages.length).toBeGreaterThan(0);

    const dir = path.join(OUT, book.id);
    await mkdir(dir, { recursive: true });
    const spreads: Spread[] = pickSpreads(project);
    await page.addScriptTag({ content: renderer });
    const images = await page.evaluate(
      ([p, s]) => (window as unknown as { __renderSample: (p: Project, s: Spread[]) => Promise<SampleImages> }).__renderSample(p, s),
      [project, spreads] as const,
    );
    const report = sampleReport(book.id, project);
    reports.push(report);
    await Promise.all([
      writeFile(path.join(dir, "interior.pdf"), await renderInteriorPdf(project, { loadFont: nodeFontLoader })),
      writeFile(path.join(dir, "cover.pdf"), await renderCoverPdf(project, { loadFont: nodeFontLoader })),
      writeFile(path.join(dir, "cover-wrap.png"), png(images.coverWrap)),
      writeFile(path.join(dir, "cover-front.png"), png(images.coverFront)),
      writeFile(path.join(dir, "cover-thumb.png"), png(images.coverThumb)),
      writeFile(path.join(dir, "spreads.png"), png(images.spreads)),
      writeFile(path.join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`),
    ]);
  });
}

test.afterAll(async () => {
  if (!reports.length) return;
  const order = (r: SampleReport) => SAMPLE_BOOKS.findIndex((b) => b.id === r.id);
  reports.sort((a, b) => order(a) - order(b));
  await writeFile(path.join(OUT, "summary.md"), summaryMarkdown(reports));
  await writeFile(path.join(OUT, "summary.json"), `${JSON.stringify(reports, null, 2)}\n`);
  await writeFile(path.join(OUT, "index.html"), indexHtml(reports));
});
