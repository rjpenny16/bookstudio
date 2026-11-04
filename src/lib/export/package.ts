import JSZip from "jszip";
import { coverGeometry, interiorGeometry, royaltyUsd, spineWidthIn } from "@/lib/kdp/geometry";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { aiUsage } from "@/lib/preflight/aiUsage";
import { runPreflight, type PreflightReport } from "@/lib/preflight";
import { fontDef, type FontBytesLoader } from "@/lib/render/fonts";
import { renderCoverPdf, renderInteriorPdf } from "@/lib/render/pdf";
import { ebookRoyalty } from "@/lib/kdp/ebook";
import { FILL_IN_TYPES, RULES_VERSION_EBOOK } from "@/lib/kdp/rules-ebook";
import { measuredEbookMb } from "@/lib/preflight/ebook";
import { ebookLayoutOf } from "./ebookBlocks";
import { editionOf, formatAsin, formatIsbn, formatPrice } from "@/lib/schema/formats";
import { hardcoverProject, hardcoverReady, hardcoverSpec } from "@/lib/schema/hardcover";
import { isReadableSchema, migrateProject } from "@/lib/schema/migrate";
import { isLowContent, SCHEMA_VERSION, type Element, type Project } from "@/lib/schema/project";
import { round, ptToIn } from "@/lib/util/ids";

export const PROJECT_FILE = "project.bookstudio.json";

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "book";
}

/** Print formats the package has files for: the paperback, and the hardcover when it is on and possible. */
export function printFormats(p: Project): ("paperback" | "hardcover")[] {
  return editionOf(p, "hardcover").enabled && hardcoverReady(p).ok ? ["paperback", "hardcover"] : ["paperback"];
}

/** Listing and print data for one print format. The hardcover has its own spec, ISBN, price and ASIN. */
export function metadataJson(p: Project, format: "paperback" | "hardcover" = "paperback") {
  const n = p.interior.pages.length;
  const hc = format === "hardcover";
  const spec = hc ? hardcoverSpec(p) : p.spec;
  const listPriceUsd = formatPrice(p, format) ?? 0;
  const r = royaltyUsd(spec, n, listPriceUsd);
  const asin = formatAsin(p, format);
  const { asin: _asin, ...metadata } = p.metadata;
  void _asin;
  return {
    schemaVersion: SCHEMA_VERSION,
    marketplace: "amazon-kdp",
    format,
    ...metadata,
    ...(asin ? { asin } : {}),
    isbn: formatIsbn(p, format),
    listPriceUsd,
    keywords: p.metadata.keywords.filter((k) => k.trim()),
    lowContent: isLowContent(p.bookType),
    print: {
      trim: `${p.spec.widthIn} x ${p.spec.heightIn} in`,
      pageCount: n,
      bleed: p.spec.bleed,
      paper: p.spec.paper,
      ink: p.spec.ink,
      coverFinish: p.spec.coverFinish,
      spineWidthIn: round(spineWidthIn(spec, n), 4),
      ...(hc ? { coverIn: ((cg) => `${round(cg.width / 72, 3)} x ${round(cg.height / 72, 3)}`)(coverGeometry(spec, n)) } : {}),
    },
    pricing: { listPriceUsd, printCostUsd: r.printCost, royaltyRate: r.rate, royaltyUsd: r.royalty, minListPriceUsd: r.minListPrice },
  };
}

/** Listing data for the Kindle eBook: same listing, its own price and ASIN, no ISBN, royalty from the measured file size. */
export function ebookMetadataJson(p: Project) {
  const e = editionOf(p, "ebook");
  const listPriceUsd = formatPrice(p, "ebook") ?? 0;
  const mb = measuredEbookMb(p);
  const r = ebookRoyalty(listPriceUsd, mb ?? 0);
  const plan = e.royaltyPlan ?? r.best;
  const asin = formatAsin(p, "ebook");
  const { asin: _asin, ...metadata } = p.metadata;
  void _asin;
  return {
    schemaVersion: SCHEMA_VERSION,
    marketplace: "amazon-kdp",
    format: "ebook" as const,
    ...metadata,
    ...(asin ? { asin } : {}),
    isbn: { kind: "none" as const, value: "" },
    listPriceUsd,
    keywords: p.metadata.keywords.filter((k) => k.trim()),
    lowContent: isLowContent(p.bookType),
    print: undefined,
    ebook: { layout: ebookLayoutOf(p) === "text" ? "text (reflowable; puzzles as images)" : "fixed (one image per page)", pageCount: p.interior.pages.length, image: e.ebookImage ?? "standard", fileMb: mb == null ? null : round(mb, 2), rulesVersion: RULES_VERSION_EBOOK },
    pricing: {
      listPriceUsd,
      royaltyPlan: `${plan}%`,
      royaltyRate: plan === "70" ? 0.7 : 0.35,
      deliveryUsd: plan === "70" ? r.seventy.deliveryUsd : 0,
      royaltyUsd: plan === "70" ? r.seventy.royaltyUsd : r.thirtyFive.royaltyUsd,
    },
  };
}

/** Formats the package has files for, in order. */
export function packageFormats(p: Project): ("paperback" | "hardcover" | "ebook")[] {
  return [...printFormats(p), ...(editionOf(p, "ebook").enabled ? (["ebook"] as const) : [])];
}

/** One row per format. */
export function metadataCsv(p: Project): string {
  const rows = packageFormats(p).map((f) => metadataCsvColumns(f === "ebook" ? ebookMetadataJson(p) : metadataJson(p, f)));
  return `${rows[0].map(([k]) => k).join(",")}\n${rows.map((cols) => cols.map(([, v]) => csvCell(v)).join(",")).join("\n")}\n`;
}

function metadataCsvColumns(m: ReturnType<typeof metadataJson> | ReturnType<typeof ebookMetadataJson>): [string, unknown][] {
  return [
    ["format", m.format],
    ["title", m.title],
    ["subtitle", m.subtitle],
    ["author", m.author],
    ["series", m.series],
    ["edition", m.edition],
    ["language", m.language],
    ["description", m.description],
    ...Array.from({ length: 7 }, (_, i) => [`keyword_${i + 1}`, m.keywords[i] ?? ""] as [string, unknown]),
    ...Array.from({ length: 3 }, (_, i) => [`category_${i + 1}`, m.categories[i] ?? ""] as [string, unknown]),
    ["isbn", m.isbn.kind === "own" ? m.isbn.value : m.isbn.kind],
    ["low_content", m.lowContent],
    ["adult_content", m.adultContent],
    ["trim", m.print?.trim ?? ""],
    ["page_count", m.print?.pageCount ?? ("ebook" in m ? m.ebook.pageCount : "")],
    ["bleed", m.print?.bleed ?? ""],
    ["paper", m.print?.paper ?? ""],
    ["ink", m.print?.ink ?? ""],
    ["cover_finish", m.print?.coverFinish ?? ""],
    ["list_price_usd", m.pricing.listPriceUsd],
    ["ai_text", m.aiDisclosure.text],
    ["ai_images", m.aiDisclosure.images],
    ["ai_translation", m.aiDisclosure.translation],
  ];
}

export function provenanceJson(p: Project) {
  const artifacts: { artifactId: string; location: string; origin: string; runId?: string; generator?: string; humanEdited?: boolean }[] = [];
  const scan = (els: Element[], location: string) => {
    for (const el of els) if (el.provenance && el.provenance.origin !== "human") artifacts.push({ artifactId: el.id, location, ...el.provenance });
  };
  p.interior.pages.forEach((pg, i) => scan(pg.elements, `interior/page-${i + 1}`));
  scan(p.cover.elements, "cover");
  const usage = aiUsage(p);
  return {
    project: p.id,
    generatedAt: new Date().toISOString(),
    kdpDisclosure: { required: usage.text || usage.images, answers: p.metadata.aiDisclosure, aiTextSources: usage.textSources, aiImageSources: usage.imageSources },
    modelRuns: p.modelRuns,
    assets: p.assets.map((a) => ({ id: a.id, name: a.name, origin: a.origin, contentHash: a.contentHash, license: a.license })),
    aiGeneratedArtifacts: artifacts.filter((a) => a.origin === "ai-generated"),
    userUploadedArtifactCount: artifacts.filter((a) => a.origin === "user-upload").length,
    generatedArtifactCount: artifacts.filter((a) => a.origin === "generated").length,
  };
}

export function licensesJson(p: Project) {
  const families = new Set<string>();
  const scan = (els: Element[]) => els.forEach((e) => e.type === "text" && families.add(e.fontFamily));
  p.interior.pages.forEach((pg) => scan(pg.elements));
  scan(p.cover.elements);
  if (p.interior.pageNumbers.enabled) families.add(p.interior.pageNumbers.fontFamily);
  return {
    fonts: [...families].map((f) => ({ family: f, license: "OFL-1.1", copyright: fontDef(f).copyright, embedded: true, commercialUse: true })),
    assets: p.assets.map((a) => ({ id: a.id, name: a.name, origin: a.origin, ...a.license })),
    unresolved: p.assets.filter((a) => !a.license.commercialUse).map((a) => a.name),
  };
}

export function preflightHtml(p: Project, report: PreflightReport): string {
  const icon = { pass: "✓", info: "i", warn: "!", fail: "✗" } as const;
  const rows = report.checks
    .map((c) => `<tr class="${c.status}"><td>${icon[c.status]}</td><td><b>${escapeHtml(c.title)}</b><br>${escapeHtml(c.summary)}${c.issues.length ? `<ul>${c.issues.map((i) => `<li>${escapeHtml(i.message)}</li>`).join("")}</ul>` : ""}</td></tr>`)
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>Preflight: ${escapeHtml(p.metadata.title || p.name)}</title>
<style>body{font:14px system-ui,sans-serif;max-width:820px;margin:32px auto;padding:0 16px;color:#1d1d1f}td{vertical-align:top;padding:8px;border-bottom:1px solid #eee}td:first-child{width:24px;font-weight:700}.pass td:first-child,.info td:first-child{color:#1a7f37}.warn td:first-child{color:#9a6700}.fail td:first-child{color:#cf222e}ul{margin:4px 0 0;padding-left:18px;color:#555}</style>
<h1>KDP preflight</h1><p>${escapeHtml(p.metadata.title || p.name)} · rules ${report.rulesVersion} · ${report.passed}/${report.total} passed · ${new Date(report.checkedAt).toLocaleString()}</p><table>${rows}</table>`;
}

export function handoffReadme(p: Project, report: PreflightReport): string {
  const n = p.interior.pages.length;
  const cg = coverGeometry(p.spec, n);
  const g = interiorGeometry(p.spec, n);
  const d = p.metadata.aiDisclosure;
  const lbl = { none: "No", some: "Yes, some", most: "Yes, most or all" } as const;
  return `BookStudio KDP package: ${p.metadata.title || p.name}
Rules version: ${RULES_VERSION}
Preflight: ${report.passed}/${report.total} checks passed, ${report.blocking} blocking

PRINT FILES
  interior.pdf  ${n} pages, ${round(ptToIn(g.pageW))}" x ${round(ptToIn(g.pageH))}" per page (${p.spec.bleed ? "with bleed" : "no bleed"})
  cover.pdf     ${round(ptToIn(cg.width), 3)}" x ${round(ptToIn(cg.height), 3)}" full wrap, spine ${round(ptToIn(cg.spine), 4)}"

UPLOAD ON KDP (Bookshelf > Create > Paperback)
  1. Paperback Details: copy title, subtitle, author, description, keywords and
     categories from metadata.json / metadata.csv.${isLowContent(p.bookType) ? "\n     Tick \"Low-content book\" (no free KDP ISBN for low-content titles)." : ""}
  2. Content: choose ${p.spec.paper} paper, ${p.spec.ink} ink, trim ${p.spec.widthIn}" x ${p.spec.heightIn}",
     bleed: ${p.spec.bleed ? "Bleed (PDF only)" : "No Bleed"}, cover finish: ${p.spec.coverFinish}.
     Upload interior.pdf and cover.pdf ("Upload a cover you already have").
  3. AI-generated content (KDP asks this on the Content page):
       Text:         ${lbl[d.text]}
       Images:       ${lbl[d.images]}
       Translations: ${lbl[d.translation]}
     Evidence is in ai-provenance.json.
  4. Launch the Print Previewer and check every flagged page.
  5. Rights & Pricing: list price $${p.metadata.listPriceUsd.toFixed(2)} USD (see metadata.json for royalty).

${printFormats(p).includes("hardcover") ? hardcoverReadme(p) : ""}${editionOf(p, "ebook").enabled ? ebookReadme(p) : ""}BookStudio never stores KDP credentials and does not publish for you: the final
review and the Publish button stay with you.
`;
}

function ebookReadme(p: Project): string {
  const m = ebookMetadataJson(p);
  return `KINDLE EBOOK (ebook/ folder; Bookshelf > + Create > Kindle eBook)
  ebook/book.epub                 ${m.ebook.layout} EPUB (${m.ebook.pageCount} print pages${m.ebook.fileMb != null ? `, ${m.ebook.fileMb} MB` : ""})
  ebook/cover.jpg                 Kindle cover, 1600 x 2560 px
  ebook/kindle-create-source.pdf  the interior without bleed, for Kindle Create
  1. Use exactly the same title, subtitle and author as the print book so Amazon
     links the formats. No ISBN is needed for a Kindle eBook.
  2. Kindle eBook Content: upload ebook/book.epub as the manuscript and ebook/cover.jpg
     as the cover, then check every page in the Kindle Previewer.
     If KDP turns the EPUB down, open Kindle Create, import
     ebook/kindle-create-source.pdf as a print replica, and upload the .kpf it saves.
  3. Pricing: ${m.listPriceUsd ? `$${m.listPriceUsd.toFixed(2)} USD at ${m.pricing.royaltyPlan} royalty, about $${m.pricing.royaltyUsd.toFixed(2)} a sale` : "no price set yet"}${m.pricing.deliveryUsd ? ` after a $${m.pricing.deliveryUsd.toFixed(2)} delivery fee` : ""}.${FILL_IN_TYPES.includes(p.bookType) ? "\n  4. Readers can't write in a Kindle eBook: say so in the eBook description." : ""}
  KDP allows 2 new eBook titles a week; record it in BookStudio's Formats panel.

`;
}

function hardcoverReadme(p: Project): string {
  const n = p.interior.pages.length;
  const hc = hardcoverProject(p);
  const cg = coverGeometry(hc.spec, n);
  const e = editionOf(p, "hardcover");
  const isbn = formatIsbn(p, "hardcover");
  const price = formatPrice(p, "hardcover");
  return `HARDCOVER (hardcover/ folder; Bookshelf > + Create > Hardcover)
  hardcover/interior.pdf  the same interior as the paperback
  hardcover/cover.pdf     ${round(ptToIn(cg.width), 3)}" x ${round(ptToIn(cg.height), 3)}" case-laminate wrap, spine ${round(ptToIn(cg.spine), 4)}"
  1. Use exactly the same title, subtitle, author and series as the paperback,
     so Amazon links both formats on one product page.
  2. ISBN: ${isbn.kind === "own" ? isbn.value : isbn.kind === "kdp-free" ? "get a free KDP ISBN (each format needs its own)" : "none chosen yet"}.
  3. Content: ${hc.spec.paper} paper, ${hc.spec.ink} ink, trim ${hc.spec.widthIn}" x ${hc.spec.heightIn}", ${hc.spec.coverFinish} finish.
     Upload hardcover/interior.pdf and hardcover/cover.pdf.${e.coverCheck?.adopt ? "\n     The cover is sized to the KDP cover calculator size you entered." : "\n     Check the cover size against KDP's hardcover cover calculator first."}
  4. Rights & Pricing: list price ${price != null ? `$${price.toFixed(2)} USD` : "not set yet"} (see hardcover/metadata.json for royalty).
  5. KDP allows 2 new hardcover titles a week; record it in BookStudio's Formats panel.

`;
}

export interface PackageOptions {
  loadFont: FontBytesLoader;
  coverPreviewPng?: Blob;
  mockupPng?: Blob;
  hardcoverMockupPng?: Blob;
  /** The Kindle eBook, built in the browser (pages are rendered to images there). */
  ebook?: { epub: Uint8Array; coverJpg: Blob | Uint8Array };
  onProgress?: (label: string, fraction: number) => void;
}

export async function buildKdpPackage(project: Project, opts: PackageOptions): Promise<Blob> {
  const zip = new JSZip();
  const report = runPreflight(project);
  opts.onProgress?.("Rendering interior", 0);
  const interior = await renderInteriorPdf(project, { loadFont: opts.loadFont, onProgress: (d, t) => opts.onProgress?.("Rendering interior", (d / t) * 0.7) });
  zip.file("interior.pdf", interior);
  opts.onProgress?.("Rendering cover", 0.75);
  zip.file("cover.pdf", await renderCoverPdf(project, { loadFont: opts.loadFont }));
  if (opts.coverPreviewPng) zip.file("cover-preview.png", opts.coverPreviewPng);
  if (opts.mockupPng) zip.file("mockups/paperback.png", opts.mockupPng);
  opts.onProgress?.("Writing metadata", 0.85);
  if (printFormats(project).includes("hardcover")) {
    opts.onProgress?.("Rendering hardcover cover", 0.8);
    zip.file("hardcover/interior.pdf", interior);
    zip.file("hardcover/cover.pdf", await renderCoverPdf(hardcoverProject(project), { loadFont: opts.loadFont }));
    zip.file("hardcover/metadata.json", JSON.stringify(metadataJson(project, "hardcover"), null, 2));
    if (opts.hardcoverMockupPng) zip.file("mockups/hardcover.png", opts.hardcoverMockupPng);
  }
  if (opts.ebook && editionOf(project, "ebook").enabled) {
    opts.onProgress?.("Adding the eBook", 0.85);
    zip.file("ebook/book.epub", opts.ebook.epub);
    zip.file("ebook/cover.jpg", opts.ebook.coverJpg);
    const noBleed = project.spec.bleed ? await renderInteriorPdf({ ...project, spec: { ...project.spec, bleed: false } }, { loadFont: opts.loadFont }) : interior;
    zip.file("ebook/kindle-create-source.pdf", noBleed);
    zip.file("ebook/metadata.json", JSON.stringify(ebookMetadataJson(project), null, 2));
  }
  zip.file("metadata.json", JSON.stringify(metadataJson(project), null, 2));
  zip.file("metadata.csv", metadataCsv(project));
  zip.file("keywords.csv", `slot,keyword,characters\n${project.metadata.keywords.map((k, i) => `${i + 1},${csvCell(k)},${k.length}`).join("\n")}\n`);
  zip.file("preflight.json", JSON.stringify(report, null, 2));
  zip.file("preflight.html", preflightHtml(project, report));
  zip.file("ai-provenance.json", JSON.stringify(provenanceJson(project), null, 2));
  zip.file("licenses.json", JSON.stringify(licensesJson(project), null, 2));
  zip.file(PROJECT_FILE, JSON.stringify(project));
  zip.file("README.txt", handoffReadme(project, report));
  opts.onProgress?.("Compressing", 0.9);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  opts.onProgress?.("Done", 1);
  return blob;
}

export function parseProjectFile(text: string): Project {
  const data = JSON.parse(text) as Project;
  if (!data || typeof data !== "object" || !isReadableSchema(data.schemaVersion) || !data.spec || !data.interior?.pages || !data.cover) {
    throw new Error(`This is not a BookStudio project file (schema ${SCHEMA_VERSION} or earlier).`);
  }
  return migrateProject(data);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
