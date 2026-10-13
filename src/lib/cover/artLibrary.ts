import type { CoverGeometry } from "@/lib/kdp/geometry";
import type { CoverArtCandidate, ModelRun, Project } from "@/lib/schema/project";
import { artBox, layoutDpi, type ArtTemplateId } from "./art";
import type { GenreId } from "./genres";

/**
 * The art library: every generated cover image, kept in the browser across
 * projects so a leftover can be reused instead of generating more. This file
 * holds the parts that don't touch storage (ranking, adding one to a project);
 * lib/storage/artLibrary keeps the entries.
 */

/** A library entry as listed, without the full image. */
export interface LibraryArtSummary extends Omit<CoverArtCandidate, "dataUrl"> {
  /** Small JPEG for the library grid; empty when one couldn't be made. */
  thumbUrl: string;
  projectId: string;
  projectTitle: string;
  genre: GenreId;
  /** Put on a cover at least once, in any project. */
  used: boolean;
  favorite: boolean;
}

export interface LibraryArt extends LibraryArtSummary {
  dataUrl: string;
  /** The run that made the image, so a project that reuses it keeps the provenance. */
  run?: ModelRun;
}

/** Most candidates kept on a project; the library keeps the rest. */
export const KEEP_CANDIDATES = 8;

/** Share of the image left after cropping it to a box of this aspect (1 = no crop). */
export function cropKept(widthPx: number, heightPx: number, boxAspect: number): number {
  const a = widthPx / heightPx;
  return Math.min(a, boxAspect) / Math.max(a, boxAspect);
}

/** Below this share kept, a crop loses enough of the picture that the image is listed as a poor fit. */
export const GOOD_FIT = 0.75;

export interface LibraryMatch {
  entry: LibraryArtSummary;
  /** Share of the image the layout's crop keeps. */
  kept: number;
  /** Print resolution at this layout, before any upscale. */
  dpi: number;
  sameGenre: boolean;
}

export interface LibraryFilter {
  layout: ArtTemplateId;
  cg: CoverGeometry;
  genre: GenreId;
  sameGenreOnly?: boolean;
  goodFitOnly?: boolean;
  favoritesOnly?: boolean;
  /** Ids already on the project. */
  exclude?: ReadonlySet<string>;
}

/** Library entries for a layout: good fits, then the same kind of book, then favorites, then newest. */
export function rankLibrary(entries: LibraryArtSummary[], f: LibraryFilter): LibraryMatch[] {
  const box = artBox(f.layout, f.cg);
  return entries
    .filter((e) => !f.exclude?.has(e.id) && (!f.favoritesOnly || e.favorite) && (!f.sameGenreOnly || e.genre === f.genre))
    .map((entry) => ({ entry, kept: cropKept(entry.widthPx, entry.heightPx, box.width / box.height), dpi: layoutDpi(f.layout, f.cg, entry.widthPx, entry.heightPx), sameGenre: entry.genre === f.genre }))
    .filter((m) => !f.goodFitOnly || m.kept >= GOOD_FIT)
    .sort((a, b) => Number(b.kept >= GOOD_FIT) - Number(a.kept >= GOOD_FIT) || Number(b.sameGenre) - Number(a.sameGenre) || Number(b.entry.favorite) - Number(a.entry.favorite) || b.entry.createdAt.localeCompare(a.entry.createdAt));
}

/** Newest first, capped, never dropping the candidate on the cover. */
export function keepCandidates(list: CoverArtCandidate[], chosenId: string | undefined, max = KEEP_CANDIDATES): CoverArtCandidate[] {
  const seen = new Set<string>();
  const unique = list.filter((c) => !seen.has(c.id) && seen.add(c.id));
  const kept = unique.slice(0, max);
  const chosen = unique.find((c) => c.id === chosenId);
  return chosen && !kept.includes(chosen) ? [...kept.slice(0, max - 1), chosen] : kept;
}

/** The project-side copy of a library image, set to the layout it's being added for. */
export function libraryCandidate(art: LibraryArt, layout: ArtTemplateId): CoverArtCandidate {
  const { id, name, prompt, dataUrl, widthPx, heightPx, provider, model, runId, createdAt } = art;
  return { id, name, prompt, dataUrl, widthPx, heightPx, provider, model, runId, layout, createdAt };
}

/** Put a library image first among the project's candidates (works on an immer draft). */
export function addLibraryArt(project: Project, art: LibraryArt, layout: ArtTemplateId): void {
  const prev = project.coverArt?.candidates ?? [];
  project.coverArt = { ...project.coverArt, candidates: keepCandidates([libraryCandidate(art, layout), ...prev.filter((c) => c.id !== art.id)], project.coverArt?.chosenId) };
  if (art.run && !project.modelRuns.some((r) => r.id === art.run!.id)) project.modelRuns.push(art.run);
}
