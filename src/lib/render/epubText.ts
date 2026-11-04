import type { EbookBlock } from "@/lib/export/ebookBlocks";
import { epubZip, esc, ext, finishEpub, pad, STORE, type EpubImage } from "./epub";

/**
 * A reflowable EPUB 3: prose as real text the reader can resize and search, and
 * puzzles (and anything else that can't reflow) as pictures that fit the screen.
 * No fixed-layout metadata, so the Kindle lays it out. Pure: page images come from
 * the caller, keyed by page index.
 */
export interface TextEpubInput {
  title: string;
  author: string;
  language: string;
  id?: string;
  modified?: Date;
  cover: EpubImage;
  blocks: EbookBlock[];
  /** Rendered page images for the image blocks, by page index. */
  images: Map<number, EpubImage>;
}

export const TEXT_EPUB_CSS = `body{margin:0 4%;line-height:1.4}
h1,h2{text-align:center;font-weight:bold;margin:1.2em 0 .8em;page-break-after:avoid}
h1{font-size:1.6em}h2{font-size:1.3em}
.kicker{text-align:center;text-transform:uppercase;letter-spacing:.15em;font-size:.8em;margin:2em 0 0}
.subtitle,.author{text-align:center;font-style:italic}
.title-page{margin-top:30%}
p{margin:0;text-indent:1.4em;text-align:justify}
p.first,h1+p,h2+p,.kicker+h2+p{text-indent:0}
.plain p{text-indent:0;margin:0 0 .8em}
figure{margin:1em 0;text-align:center;page-break-before:always;page-break-inside:avoid}
img{max-width:100%;height:auto}
`;

const doc = (title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;

const paras = (ps: string[]) => ps.map((p, i) => `<p${i === 0 ? ' class="first"' : ""}>${esc(p)}</p>`).join("\n");

/** One XHTML document per block, and the label it gets in the contents (if any). */
function blockDoc(b: EbookBlock, images: Map<number, EpubImage>): { html: string; label: string | null; pageIndices: number[] } {
  switch (b.type) {
    case "title":
      return { html: `<section class="title-page" epub:type="titlepage"><h1>${esc(b.title)}</h1>${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ""}${b.author ? `<p class="author">${esc(b.author)}</p>` : ""}</section>`, label: null, pageIndices: [] };
    case "chapter":
      return { html: `<section epub:type="chapter">${b.kicker ? `<p class="kicker">${esc(b.kicker)}</p>` : ""}<h2>${esc(b.title)}</h2>\n${paras(b.paragraphs)}</section>`, label: b.title || b.kicker || "Chapter", pageIndices: [] };
    case "text":
      return { html: `<section class="plain">${b.title ? `<h2>${esc(b.title)}</h2>\n` : ""}${paras(b.paragraphs)}</section>`, label: b.title || null, pageIndices: [] };
    case "heading":
      return { html: `<section>${b.kicker ? `<p class="kicker">${esc(b.kicker)}</p>` : ""}<h1>${esc(b.title)}</h1>${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ""}</section>`, label: b.title || null, pageIndices: [] };
    case "images": {
      const figs = b.pageIndices
        .filter((i) => images.has(i))
        .map((i) => `<figure><img src="images/p${pad(i + 1)}.${ext(images.get(i)!.mime)}" alt="${esc(`${b.label}, page ${i + 1}`)}"/></figure>`)
        .join("\n");
      return { html: `<section>${figs}</section>`, label: b.label, pageIndices: b.pageIndices.filter((i) => images.has(i)) };
    }
  }
}

export async function buildTextEpub(input: TextEpubInput): Promise<Uint8Array> {
  const id = input.id ?? crypto.randomUUID();
  const modified = (input.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const zip = epubZip();
  const coverHref = `images/cover.${ext(input.cover.mime)}`;
  zip.file(`OEBPS/${coverHref}`, input.cover.bytes, STORE);
  zip.file("OEBPS/style.css", TEXT_EPUB_CSS);
  zip.file("OEBPS/cover.xhtml", doc("Cover", `<section epub:type="cover"><img src="${coverHref}" alt="Cover"/></section>`));

  const items: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="cover-image" href="${coverHref}" media-type="${input.cover.mime}" properties="cover-image"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
  ];
  const spine = [`<itemref idref="cover" linear="yes"/>`];
  const toc: { label: string; href: string }[] = [];
  const usedImages = new Set<number>();
  input.blocks.forEach((b, n) => {
    const name = `s${pad(n + 1)}.xhtml`;
    const { html, label, pageIndices } = blockDoc(b, input.images);
    zip.file(`OEBPS/${name}`, doc(label ?? input.title, html));
    items.push(`<item id="s${pad(n + 1)}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="s${pad(n + 1)}"/>`);
    if (label) toc.push({ label, href: name });
    pageIndices.forEach((i) => usedImages.add(i));
  });
  for (const i of [...usedImages].sort((a, b) => a - b)) {
    const img = input.images.get(i)!;
    const href = `images/p${pad(i + 1)}.${ext(img.mime)}`;
    zip.file(`OEBPS/${href}`, img.bytes, STORE);
    items.push(`<item id="img${pad(i + 1)}" href="${href}" media-type="${img.mime}"/>`);
  }

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
<dc:title>${esc(input.title)}</dc:title>
<dc:creator>${esc(input.author)}</dc:creator>
<dc:language>${esc(input.language)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
${items.join("\n")}
</manifest>
<spine>
${spine.join("\n")}
</spine>
</package>
`,
  );
  const first = toc[0]?.href ?? (input.blocks.length ? "s0001.xhtml" : "cover.xhtml");
  zip.file(
    "OEBPS/nav.xhtml",
    doc(
      "Contents",
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${(toc.length ? toc : [{ label: input.title || "Start", href: first }]).map((t) => `<li><a href="${t.href}">${esc(t.label)}</a></li>`).join("\n")}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
<li><a epub:type="bodymatter" href="${first}">Start</a></li>
</ol></nav>`,
    ),
  );
  return finishEpub(zip);
}
