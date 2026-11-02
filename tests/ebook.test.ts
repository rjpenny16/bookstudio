import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildKdpPackage, ebookMetadataJson, metadataCsv, packageFormats } from "@/lib/export/package";
import { deliveryFeeUsd, ebookMinPrice, ebookRoyalty } from "@/lib/kdp/ebook";
import { runPreflight } from "@/lib/preflight";
import { buildFixedLayoutEpub, languageCode, type EpubImage } from "@/lib/render/epub";
import { createProject } from "@/lib/schema/factory";
import { editionDraft } from "@/lib/schema/formats";
import type { Project } from "@/lib/schema/project";
import { nodeFontLoader } from "./helpers";

const img = (w = 1067, h = 1600): EpubImage => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg", width: w, height: h });

describe("Kindle royalty", () => {
  it("charges the 70% delivery fee per MB and allows 70% only from $2.99 to $12.99", () => {
    expect(deliveryFeeUsd(10)).toBe(1.5);
    expect(deliveryFeeUsd(0)).toBe(0.01);
    const r = ebookRoyalty(4.99, 2);
    expect(r.seventy).toMatchObject({ eligible: true, deliveryUsd: 0.3, royaltyUsd: 3.19 });
    expect(r.thirtyFive.royaltyUsd).toBe(1.75);
    expect(r.best).toBe("70");
    expect(ebookRoyalty(2.98, 1).seventy.eligible).toBe(false);
    expect(ebookRoyalty(12.99, 1).seventy.eligible).toBe(true);
    expect(ebookRoyalty(13.99, 1).best).toBe("35");
  });

  it("recommends 35% when a big file's delivery fee outweighs the higher rate", () => {
    // $4.99 at 40 MB: 70% pays 3.49 - 6.00 < 0; 35% pays 1.75.
    expect(ebookRoyalty(4.99, 40).best).toBe("35");
  });

  it("raises the lowest 35% price with file size", () => {
    expect(ebookMinPrice(2)).toBe(0.99);
    expect(ebookMinPrice(5)).toBe(1.99);
    expect(ebookMinPrice(50)).toBe(2.99);
  });
});

describe("fixed-layout EPUB", () => {
  it("is a valid EPUB container with fixed-layout metadata, a cover and one page per image", async () => {
    const bytes = await buildFixedLayoutEpub({
      title: "Puzzles & More <Vol 1>",
      author: "Ada",
      language: languageCode("English"),
      id: "12345678-1234-1234-1234-123456789abc",
      modified: new Date("2026-11-02T10:20:30.456Z"),
      cover: img(1600, 2560),
      pages: [img(), img(), img()],
      toc: [{ label: "Word searches", pageIndex: 0 }, { label: "Answers", pageIndex: 2 }, { label: "Out of range", pageIndex: 9 }],
    });
    // mimetype is the first entry, stored (method 0), with no extra field before its content.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLen))).toBe("mimetype");
    expect(new TextDecoder().decode(bytes.slice(30 + nameLen + extraLen, 30 + nameLen + extraLen + 20))).toBe("application/epub+zip");

    const zip = await JSZip.loadAsync(bytes);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    expect(opf).toContain('<meta property="rendition:spread">none</meta>');
    expect(opf).toContain('<meta name="fixed-layout" content="true"/>');
    expect(opf).toContain('<meta name="original-resolution" content="1067x1600"/>');
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain("<dc:language>en</dc:language>");
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-02T10:20:30Z</meta>');
    expect(opf).toContain("Puzzles &amp; More &lt;Vol 1&gt;");
    expect(opf.match(/<itemref /g)).toHaveLength(4); // cover + 3 pages
    expect(zip.file("OEBPS/p0003.xhtml")).not.toBeNull();
    expect(await zip.file("OEBPS/p0001.xhtml")!.async("string")).toContain('content="width=1067, height=1600"');
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    expect(nav).toContain('<a href="p0001.xhtml">Word searches</a>');
    expect(nav).toContain('<a href="p0003.xhtml">Answers</a>');
    expect(nav).not.toContain("Out of range");
    expect(await zip.file("META-INF/container.xml")!.async("string")).toContain('full-path="OEBPS/content.opf"');
  });

  it("maps listing languages to codes", () => {
    expect(languageCode("English")).toBe("en");
    expect(languageCode("Spanish")).toBe("es");
    expect(languageCode("pt-BR")).toBe("pt-BR");
    expect(languageCode("Klingon")).toBe("en");
  });
});

const book = (bookType: Project["bookType"] = "puzzle"): Project =>
  createProject({ name: "Big Puzzle Book", bookType, trimId: "6x9", paper: "white", ink: "black", bleed: true, author: "Ada", interior: [{ kind: "blank", count: 100 }] });

const withEbook = (p: Project, fn: (e: ReturnType<typeof editionDraft>) => void = () => {}): Project => {
  const q = structuredClone(p);
  const e = editionDraft(q, "ebook");
  e.enabled = true;
  fn(e);
  return q;
};

describe("eBook preflight", () => {
  const find = (p: Project) => runPreflight(p).checks.find((c) => c.id === "ebook");

  it("only runs when the eBook is on, and asks to build it and price it", () => {
    expect(find(book())).toBeUndefined();
    const c = find(withEbook(book()))!;
    expect(c.status).toBe("warn");
    const text = c.issues.map((i) => i.message).join(" ");
    expect(text).toMatch(/Build the eBook/);
    expect(text).toMatch(/eBook list price/);
    expect(text).toMatch(/can't write in an eBook/);
  });

  it("blocks a 70% price outside the band, and warns when 35% would pay more", () => {
    const mb = (n: number) => n * 1024 * 1024;
    const tooCheap = withEbook(book(), (e) => {
      e.listPriceUsd = 1.99;
      e.royaltyPlan = "70";
      e.ebookSize = { bytes: mb(2), pages: 100, image: "standard" };
    });
    expect(find(tooCheap)!.status).toBe("fail");
    const heavy = withEbook(book(), (e) => {
      e.listPriceUsd = 4.99;
      e.royaltyPlan = "70";
      e.ebookSize = { bytes: mb(40), pages: 100, image: "standard" };
    });
    expect(find(heavy)!.issues.map((i) => i.message).join(" ")).toMatch(/35% pay more/);
    // A size measured for another page count no longer counts.
    const stale = withEbook(book(), (e) => (e.ebookSize = { bytes: mb(2), pages: 50, image: "standard" }));
    expect(find(stale)!.issues.map((i) => i.message).join(" ")).toMatch(/Build the eBook/);
  });

  it("warns that a mostly blank notebook is a poor eBook", () => {
    expect(find(withEbook(book("notebook")))!.issues.map((i) => i.message).join(" ")).toMatch(/Mostly blank/);
  });
});

describe("eBook in the package", () => {
  it("adds an ebook row and an ebook/ folder with the EPUB, cover and a no-bleed Kindle Create PDF", async () => {
    const p = withEbook(book(), (e) => {
      e.listPriceUsd = 3.99;
      e.ebookSize = { bytes: 3 * 1024 * 1024, pages: 100, image: "standard" };
    });
    expect(packageFormats(p)).toEqual(["paperback", "ebook"]);
    const m = ebookMetadataJson(p);
    expect(m).toMatchObject({ format: "ebook", listPriceUsd: 3.99, isbn: { kind: "none" } });
    expect(m.pricing.royaltyPlan).toBe("70%");
    expect(m.pricing.royaltyUsd).toBeCloseTo(3.99 * 0.7 - 0.45, 2);
    const csv = metadataCsv(p).trim().split("\n");
    expect(csv).toHaveLength(3);
    expect(csv[2].startsWith('"ebook"')).toBe(true);

    const epub = await buildFixedLayoutEpub({ title: "T", author: "A", language: "en", cover: img(1600, 2560), pages: [img()], toc: [] });
    const zip = await JSZip.loadAsync(await (await buildKdpPackage(p, { loadFont: nodeFontLoader, ebook: { epub, coverJpg: new Uint8Array([1]) } })).arrayBuffer());
    for (const f of ["ebook/book.epub", "ebook/cover.jpg", "ebook/kindle-create-source.pdf", "ebook/metadata.json"]) expect(zip.file(f), f).not.toBeNull();
    // The book has bleed; the Kindle Create PDF does not, so its pages are the trim size.
    const { PDFDocument } = await import("pdf-lib");
    const kc = await PDFDocument.load(await zip.file("ebook/kindle-create-source.pdf")!.async("uint8array"));
    expect(kc.getPage(0).getSize().width).toBeCloseTo(6 * 72, 1);
    expect(await zip.file("README.txt")!.async("string")).toMatch(/KINDLE EBOOK/);
  }, 60_000);
});
