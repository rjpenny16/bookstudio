import { genreOf } from "@/lib/cover/genres";
import { buildCover, PALETTES } from "@/lib/cover/templates";
import { coverGeometry, findTrim } from "@/lib/kdp/geometry";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { estimatePageCount, generatePages, generatorInfo, type GeneratorConfig } from "@/lib/generators/pages";
import { interiorStyle, type InteriorStyleSpec } from "@/lib/generators/style";
import { newId } from "@/lib/util/ids";
import { SCHEMA_VERSION, type BookType, type InteriorInk, type InteriorSection, type Paper, type Project } from "./project";

/** One interior section to generate: a bare config, or a config with a label and role. */
export type SectionInput = GeneratorConfig | { label: string; role?: InteriorSection["role"]; config: GeneratorConfig };

export interface NewProjectInput {
  name: string;
  bookType: BookType;
  trimId: string;
  paper: Paper;
  ink: InteriorInk;
  bleed: boolean;
  author?: string;
  /** Interior look; derived from the book type and name when unset. */
  style?: InteriorStyleSpec;
  /** Initial interior, one entry per section. Defaults to 120 lined pages. */
  interior?: SectionInput[];
}

export function emptyBrief(): Project["brief"] {
  return { topic: "", audience: "", notes: "", angle: "", titleIdeas: [], keywordIdeas: [], interiorPlan: "", coverDirection: "", risks: [] };
}

export function createProject(input: NewProjectInput): Project {
  const trim = findTrim(input.trimId) ?? findTrim("6x9")!;
  const genreId = genreOf({ bookType: input.bookType, topic: input.name, audience: "" }).id;
  const styleSpec: InteriorStyleSpec = input.style ?? { genre: genreId, largePrint: genreId === "large-print" };
  const style = interiorStyle(styleSpec);
  const now = new Date().toISOString();
  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    id: newId("prj"),
    name: input.name || "Untitled book",
    createdAt: now,
    updatedAt: now,
    bookType: input.bookType,
    spec: {
      marketplace: "amazon-kdp",
      binding: "paperback",
      trimId: trim.id,
      widthIn: trim.widthIn,
      heightIn: trim.heightIn,
      bleed: input.bleed,
      paper: input.paper,
      ink: input.ink,
      coverFinish: "matte",
      rulesVersion: RULES_VERSION,
    },
    brief: emptyBrief(),
    interior: { pages: [], sections: [], pageNumbers: { enabled: input.bookType !== "coloring", fontFamily: style.label, fontSize: style.sizes.pageNumber, startAt: 3 }, style: styleSpec },
    cover: { background: "#ffffff", elements: [], barcode: "kdp" },
    metadata: {
      title: input.name || "",
      subtitle: "",
      author: input.author ?? "",
      series: "",
      edition: "",
      description: "",
      keywords: [],
      categories: [],
      language: "English",
      listPriceUsd: 7.99,
      isbn: { kind: "none", value: "" },
      adultContent: false,
      aiDisclosure: { text: "none", images: "none", translation: "none", confirmed: false },
    },
    assets: [],
    modelRuns: [],
  };
  const inputs = input.interior ?? [{ kind: "lined", count: 120, spacingIn: 0.3125, header: true }];
  const sections: InteriorSection[] = inputs.map((s) =>
    "config" in s ? { id: newId("sec"), label: s.label, role: s.role ?? "body", config: s.config } : { id: newId("sec"), label: generatorInfo(s.kind).label, role: "body", config: s },
  );
  // The gutter depends on the final page count, so generate against the planned total.
  const hint = sections.reduce((n, s) => n + estimatePageCount(s.config), 0);
  for (const sec of sections) {
    const pages = generatePages(sec.config, { spec: project.spec, pageCountHint: hint, style });
    project.interior.pages.push(...pages.map((p) => ({ ...p, sectionId: sec.id })));
  }
  project.interior.sections = sections;
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  const genre = genreOf({ bookType: input.bookType, topic: input.name, audience: "" });
  Object.assign(
    project.cover,
    buildCover(genre.templates[0], { title: project.metadata.title, subtitle: "", author: project.metadata.author, backText: "", palette: PALETTES.find((p) => p.id === genre.palettes[0]) ?? PALETTES[0], type: genre.type }, cg),
  );
  return project;
}
