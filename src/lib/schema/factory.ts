import { buildCover, PALETTES, suggestTemplate } from "@/lib/cover/templates";
import { coverGeometry, findTrim } from "@/lib/kdp/geometry";
import { RULES_VERSION } from "@/lib/kdp/rules";
import { generatePages, type GeneratorConfig } from "@/lib/generators/pages";
import { newId } from "@/lib/util/ids";
import { SCHEMA_VERSION, type BookType, type InteriorInk, type Paper, type Project } from "./project";

export interface NewProjectInput {
  name: string;
  bookType: BookType;
  trimId: string;
  paper: Paper;
  ink: InteriorInk;
  bleed: boolean;
  author?: string;
  /** Initial interior. Defaults to 120 lined pages. */
  interior?: GeneratorConfig[];
}

export function emptyBrief(): Project["brief"] {
  return { topic: "", audience: "", notes: "", angle: "", titleIdeas: [], keywordIdeas: [], interiorPlan: "", coverDirection: "", risks: [] };
}

export function createProject(input: NewProjectInput): Project {
  const trim = findTrim(input.trimId) ?? findTrim("6x9")!;
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
    interior: { pages: [], pageNumbers: { enabled: input.bookType !== "coloring", fontFamily: "Inter", fontSize: 9, startAt: 3 } },
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
  const configs = input.interior ?? [{ kind: "lined", count: 120, spacingIn: 0.3125, header: true }];
  const hint = 120;
  for (const cfg of configs) project.interior.pages.push(...generatePages(cfg, { spec: project.spec, pageCountHint: hint }));
  const cg = coverGeometry(project.spec, project.interior.pages.length);
  Object.assign(
    project.cover,
    buildCover(suggestTemplate(input.bookType), { title: project.metadata.title, subtitle: "", author: project.metadata.author, backText: "", palette: PALETTES[0] }, cg),
  );
  return project;
}
