// Identifier shapes shared by the engine, the worker routes and the stores.
// These were re-typed in four modules; a stricter regex in one and a looser
// one in another is exactly the kind of drift that opens a hole.

/** AI job and rendition ids are v4 UUIDs, minted server-side. */
export const AI_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Published archive ids: 12 chars from an unambiguous alphabet. */
export const ARCHIVE_ID_RE = /^[a-z2-9]{12}$/;

export function isAiId(value: unknown): value is string {
  return typeof value === "string" && AI_ID_RE.test(value);
}

export function isArchiveId(value: unknown): value is string {
  return typeof value === "string" && ARCHIVE_ID_RE.test(value);
}
