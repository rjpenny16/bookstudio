import { defaultFormats, editionOf } from "./formats";
import { SCHEMA_VERSION, type Project } from "./project";

/** Schema versions this build can read and upgrade. */
const READABLE = new Set(["1.0", "1.1", SCHEMA_VERSION]);

export function isReadableSchema(version: unknown): boolean {
  return typeof version === "string" && READABLE.has(version);
}

/** Formats for a project saved before 1.2: paperback only, marked live when it already has an ASIN. */
function upgradeFormats(data: Project): Project["formats"] {
  if (Array.isArray(data.formats) && data.formats.length) return defaultFormats().map((d) => editionOf(data, d.kind));
  return defaultFormats().map((f) => (f.kind === "paperback" && data.metadata?.asin ? { ...f, kdp: { status: "live" } } : f));
}

/**
 * Upgrade a stored or imported project to the current schema.
 * 1.0 → 1.1: interiors gained `sections` (older pages simply have no section).
 * 1.1 → 1.2: books gained `formats` (paperback, hardcover, eBook) with their KDP status.
 */
export function migrateProject(data: Project): Project {
  if (data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.interior?.sections) && Array.isArray(data.formats)) return data;
  return {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    interior: { ...data.interior, sections: Array.isArray(data.interior?.sections) ? data.interior.sections : [] },
    formats: upgradeFormats(data),
  };
}
