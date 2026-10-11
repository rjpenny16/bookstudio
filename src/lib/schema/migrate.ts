import { SCHEMA_VERSION, type Project } from "./project";

/** Schema versions this build can read and upgrade. */
const READABLE = new Set(["1.0", SCHEMA_VERSION]);

export function isReadableSchema(version: unknown): boolean {
  return typeof version === "string" && READABLE.has(version);
}

/**
 * Upgrade a stored or imported project to the current schema.
 * 1.0 → 1.1: interiors gained `sections` (older pages simply have no section).
 */
export function migrateProject(data: Project): Project {
  if (data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.interior?.sections)) return data;
  return {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    interior: { ...data.interior, sections: Array.isArray(data.interior?.sections) ? data.interior.sections : [] },
  };
}
