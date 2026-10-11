import { describe, expect, it } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { FONTS } from "@/lib/render/fonts";
import { nodeFontLoader } from "./helpers";

describe("bundled fonts", () => {
  it.each(FONTS.flatMap((f) => [f.regular, f.bold].filter(Boolean) as string[]))("%s embeds in a PDF", async (file) => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(await nodeFontLoader(file), { subset: false });
    doc.addPage().drawText("The quick brown fox 0123456789", { font, size: 12 });
    expect((await doc.save()).length).toBeGreaterThan(1000);
  });
});
