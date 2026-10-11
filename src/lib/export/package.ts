import JSZip from "jszip";
import { coverGeometry, interiorGeometry, royaltyUsd, spineWidthIn } from "@/lib/kdp/geometry";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { aiUsage } from "@/lib/preflight/aiUsage";
import { runPreflight, type PreflightReport } from "@/lib/preflight";
import { fontDef, type FontBytesLoader } from "@/lib/render/fonts";
import { renderCoverPdf, renderInteriorPdf } from "@/lib/render/pdf";
import { isReadableSchema, migrateProject } from "@/lib/schema/migrate";
import { isLowContent, SCHEMA_VERSION, type Element, type Project } from "@/lib/schema/project";
import { round, ptToIn } from "@/lib/util/ids";

export const PROJECT_FILE = "project.bookstudio.json";

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "book";
}

export function metadataJson(p: Project) {
  const n = p.interior.pages.length;
  const r = royaltyUsd(p.spec, n, p.metadata.listPriceUsd);
  return {
    schemaVersion: SCHEMA_VERSION,
    marketplace: "amazon-kdp",
    format: "paperback",
    ...p.metadata,
    keywords: p.metadata.keywords.filter((k) => k.trim()),
    lowContent: isLowContent(p.bookType),
    print: {
      trim: `${p.spec.widthIn} x ${p.spec.heightIn} in`,
      pageCount: n,
      bleed: p.spec.bleed,
      paper: p.spec.paper,
      ink: p.spec.ink,
      coverFinish: p.spec.coverFinish,
      spineWidthIn: round(spineWidthIn(p.spec, n), 4),
    },
    pricing: { listPriceUsd: p.metadata.listPriceUsd, printCostUsd: r.printCost, royaltyRate: r.rate, royaltyUsd: r.royalty, minListPriceUsd: r.minListPrice },
  };
}

export function metadataCsv(p: Project): string {
  const m = metadataJson(p);
  const cols: [string, unknown][] = [
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
    ["trim", m.print.trim],
    ["page_count", m.print.pageCount],
    ["bleed", m.print.bleed],
    ["paper", m.print.paper],
    ["ink", m.print.ink],
    ["cover_finish", m.print.coverFinish],
    ["list_price_usd", m.pricing.listPriceUsd],
    ["ai_text", m.aiDisclosure.text],
    ["ai_images", m.aiDisclosure.images],
    ["ai_translation", m.aiDisclosure.translation],
  ];
  return `${cols.map(([k]) => k).join(",")}\n${cols.map(([, v]) => csvCell(v)).join(",")}\n`;
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

BookStudio never stores KDP credentials and does not publish for you: the final
review and the Publish button stay with you.
`;
}

export interface PackageOptions {
  loadFont: FontBytesLoader;
  coverPreviewPng?: Blob;
  mockupPng?: Blob;
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
