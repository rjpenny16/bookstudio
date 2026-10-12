import { describe, expect, it } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { FONTS } from "@/lib/render/fonts";
import { textWidth } from "@/lib/render/metrics";
import { buildFontMetricsSource, METRICS_FILE } from "../scripts/fontMetrics";
import { nodeFontLoader } from "./helpers";

describe("font metrics table", () => {
  it("matches the bundled fonts (run `npm run font-metrics` to regenerate)", async () => {
    const source = await buildFontMetricsSource();
    if (process.env.WRITE_FONT_METRICS) await writeFile(METRICS_FILE, source);
    expect(await readFile(METRICS_FILE, "utf8")).toBe(source);
  });

  const samples = ["Large Print Sudoku Puzzles for Seniors", "THE GRATITUDE JOURNAL", "Word Search: 120 Puzzles", "Café crème, naïve “quotes” – 2026"];
  it.each(FONTS.flatMap((f) => [{ family: f.family, bold: false }, ...(f.bold ? [{ family: f.family, bold: true }] : [])]))("measures $family (bold: $bold) like the PDF renderer", async ({ family, bold }) => {
    const def = FONTS.find((f) => f.family === family)!;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(await nodeFontLoader(bold ? def.bold! : def.regular), { subset: true });
    for (const s of samples) {
      const real = font.widthOfTextAtSize(s, 40);
      const est = textWidth(s, family, bold, 40);
      // Never meaningfully narrower than the real text (kerning makes the real text a little tighter).
      expect(est).toBeGreaterThan(real * 0.995);
      expect(est).toBeLessThan(real * 1.04);
    }
  });
});
