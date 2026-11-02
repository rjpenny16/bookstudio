import JSZip from "jszip";

/**
 * Fixed-layout (pre-paginated) EPUB 3: one page image per page, sized exactly, with the
 * metadata Kindle needs to keep the layout (EPUB 3 rendition properties plus Amazon's
 * `fixed-layout` and `original-resolution` meta tags). Pure: the page images are made by
 * the caller, so this runs in the browser and in tests.
 */

export interface EpubImage {
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export interface EpubInput {
  title: string;
  author: string;
  /** BCP 47 code, e.g. "en". */
  language: string;
  /** Stable id for the book (a UUID); one is made when missing. */
  id?: string;
  modified?: Date;
  cover: EpubImage;
  pages: EpubImage[];
  /** Table of contents: a label and the 0-based page it starts on. */
  toc: { label: string; pageIndex: number }[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const ext = (m: EpubImage["mime"]) => (m === "image/png" ? "png" : "jpg");
const pad = (n: number) => String(n).padStart(4, "0");

const LANGUAGES: Record<string, string> = { english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt", dutch: "nl", japanese: "ja" };

/** Listing language ("English") to an EPUB language code ("en"). */
export const languageCode = (language: string) => LANGUAGES[language.trim().toLowerCase()] ?? (/^[a-z]{2}(-[A-Za-z]{2})?$/.test(language.trim()) ? language.trim() : "en");

function pageXhtml(title: string, img: string, w: number, h: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=${w}, height=${h}"/>
<title>${esc(title)}</title>
<style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden}img{display:block;width:${w}px;height:${h}px}</style>
</head>
<body><img src="${img}" alt="${esc(title)}"/></body>
</html>
`;
}

export function epubOpf(input: EpubInput, id: string): string {
  const first = input.pages[0] ?? input.cover;
  const landscape = first.width > first.height;
  const modified = (input.modified ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");
  const items: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="cover-image" href="images/cover.${ext(input.cover.mime)}" media-type="${input.cover.mime}" properties="cover-image"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
  ];
  const spine: string[] = [`<itemref idref="cover" linear="yes"/>`];
  input.pages.forEach((p, i) => {
    const n = pad(i + 1);
    items.push(`<item id="img${n}" href="images/p${n}.${ext(p.mime)}" media-type="${p.mime}"/>`);
    items.push(`<item id="p${n}" href="p${n}.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="p${n}"/>`);
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
<dc:title>${esc(input.title)}</dc:title>
<dc:creator>${esc(input.author)}</dc:creator>
<dc:language>${esc(input.language)}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta property="rendition:layout">pre-paginated</meta>
<meta property="rendition:orientation">${landscape ? "landscape" : "portrait"}</meta>
<meta property="rendition:spread">none</meta>
<meta name="cover" content="cover-image"/>
<meta name="fixed-layout" content="true"/>
<meta name="original-resolution" content="${first.width}x${first.height}"/>
<meta name="orientation-lock" content="${landscape ? "landscape" : "portrait"}"/>
</metadata>
<manifest>
${items.join("\n")}
</manifest>
<spine>
${spine.join("\n")}
</spine>
</package>
`;
}

export function epubNav(input: EpubInput): string {
  const entries = input.toc.filter((t) => t.pageIndex >= 0 && t.pageIndex < input.pages.length);
  const list = entries.length ? entries : [{ label: input.title || "Start", pageIndex: 0 }];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="UTF-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${list.map((t) => `<li><a href="p${pad(t.pageIndex + 1)}.xhtml">${esc(t.label)}</a></li>`).join("\n")}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
<li><a epub:type="bodymatter" href="p${pad(1)}.xhtml">Start</a></li>
</ol></nav>
</body>
</html>
`;
}

/** Build the EPUB file. `mimetype` is the first entry and stored uncompressed, as EPUB requires. */
export async function buildFixedLayoutEpub(input: EpubInput): Promise<Uint8Array> {
  const id = input.id ?? crypto.randomUUID();
  const zip = new JSZip();
  const store = { compression: "STORE" as const };
  zip.file("mimetype", "application/epub+zip", store);
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
  );
  zip.file("OEBPS/content.opf", epubOpf(input, id));
  zip.file("OEBPS/nav.xhtml", epubNav(input));
  zip.file(`OEBPS/images/cover.${ext(input.cover.mime)}`, input.cover.bytes, store);
  zip.file("OEBPS/cover.xhtml", pageXhtml("Cover", `images/cover.${ext(input.cover.mime)}`, input.cover.width, input.cover.height));
  input.pages.forEach((p, i) => {
    const n = pad(i + 1);
    zip.file(`OEBPS/images/p${n}.${ext(p.mime)}`, p.bytes, store);
    zip.file(`OEBPS/p${n}.xhtml`, pageXhtml(`Page ${i + 1}`, `images/p${n}.${ext(p.mime)}`, p.width, p.height));
  });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/epub+zip" });
}
