// Published archives: a finished game's gallery gets a permanent public URL.
// The endpoint is unauthenticated, so the real defense is strict shape
// validation — a stored archive can only ever render as strokes, never as
// attacker-controlled markup.

import { validSegments } from "../shared/geometry";
import { SEAT_COLORS } from "../shared/palette";
import type { ArchiveEntry } from "../shared/types";

const META_MAX_BYTES = 512 * 1024;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const TTL_SECONDS = 60 * 60 * 24 * 365; // archives live for a year
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export interface StoredArchive {
  title: string;
  players: { name: string; colorIndex: number; score: number }[];
  entries: ArchiveEntry[];
  createdAt: number;
  hasImage: boolean;
}

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = "";
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return id;
}

function cleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, maxLen);
  return s.length > 0 ? s : null;
}

/** Validate an uploaded archive down to exactly the shape the page renders. */
export function validateArchive(meta: unknown): StoredArchive | null {
  if (typeof meta !== "object" || meta === null) return null;
  const m = meta as Record<string, unknown>;

  const title = cleanString(m.title, 80);
  if (!title) return null;

  if (!Array.isArray(m.players) || m.players.length < 1 || m.players.length > 12) return null;
  const players: StoredArchive["players"] = [];
  for (const raw of m.players) {
    if (typeof raw !== "object" || raw === null) return null;
    const p = raw as Record<string, unknown>;
    const name = cleanString(p.name, 18);
    if (!name) return null;
    if (
      !Number.isInteger(p.colorIndex) ||
      (p.colorIndex as number) < 0 ||
      (p.colorIndex as number) >= SEAT_COLORS.length
    ) {
      return null;
    }
    if (!Number.isInteger(p.score) || (p.score as number) < 0 || (p.score as number) > 999) {
      return null;
    }
    players.push({ name, colorIndex: p.colorIndex as number, score: p.score as number });
  }

  // Score-to-10 games can run well past ten rounds.
  if (!Array.isArray(m.entries) || m.entries.length < 1 || m.entries.length > 48) return null;
  const entries: ArchiveEntry[] = [];
  for (const raw of m.entries) {
    if (typeof raw !== "object" || raw === null) return null;
    const e = raw as Record<string, unknown>;
    const word = cleanString(e.word, 40);
    const fakeName = cleanString(e.fakeName, 18);
    if (!word || !fakeName) return null;
    if (!Number.isInteger(e.roundNo) || (e.roundNo as number) < 1 || (e.roundNo as number) > 99) {
      return null;
    }
    if (
      typeof e.outcome !== "string" ||
      !["survived", "caught_named", "caught_wrong"].includes(e.outcome)
    ) {
      return null;
    }
    if (!Array.isArray(e.strokes) || e.strokes.length > 64) return null;
    const strokes: ArchiveEntry["strokes"] = [];
    for (const rawStroke of e.strokes) {
      if (typeof rawStroke !== "object" || rawStroke === null) return null;
      const s = rawStroke as Record<string, unknown>;
      if (
        !Number.isInteger(s.colorIndex) ||
        (s.colorIndex as number) < 0 ||
        (s.colorIndex as number) >= SEAT_COLORS.length
      ) {
        return null;
      }
      const points = s.points;
      if (!Array.isArray(points) || points.length < 4 || points.length > 2048) return null;
      if (points.length % 2 !== 0) return null;
      for (const n of points) {
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) return null;
      }
      let breaks: number[] | undefined;
      if (s.breaks !== undefined) {
        if (!Array.isArray(s.breaks) || s.breaks.length > 32) return null;
        if (!s.breaks.every((b) => Number.isInteger(b))) return null;
        if (!validSegments(points as number[], s.breaks as number[])) return null;
        breaks = s.breaks as number[];
      }
      strokes.push({
        playerId: "",
        colorIndex: s.colorIndex as number,
        points: points as number[],
        ...(breaks && breaks.length > 0 ? { breaks } : {}),
      });
    }
    entries.push({
      roundNo: e.roundNo as number,
      word,
      strokes,
      outcome: e.outcome as ArchiveEntry["outcome"],
      fakeName,
    });
  }

  return { title, players, entries, createdAt: Date.now(), hasImage: false };
}

export async function handleArchivePost(request: Request, env: Env): Promise<Response> {
  // The browser always sends an exact Content-Length for multipart uploads —
  // a missing or bogus one is either abuse or a client we don't serve, and
  // must be rejected BEFORE formData() buffers the body.
  const declared = Number(request.headers.get("content-length"));
  if (
    !Number.isFinite(declared) ||
    declared <= 0 ||
    declared > META_MAX_BYTES + IMAGE_MAX_BYTES + 4096
  ) {
    return Response.json({ error: "Too large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Bad form data" }, { status: 400 });
  }

  const metaRaw = form.get("meta");
  if (typeof metaRaw !== "string" || metaRaw.length > META_MAX_BYTES) {
    return Response.json({ error: "Bad meta" }, { status: 400 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(metaRaw);
  } catch {
    return Response.json({ error: "Bad meta" }, { status: 400 });
  }
  const archive = validateArchive(parsed);
  if (!archive) {
    return Response.json({ error: "That does not look like a game archive" }, { status: 400 });
  }

  let imageBytes: ArrayBuffer | null = null;
  const image = form.get("image");
  if (image instanceof File) {
    if (image.size > IMAGE_MAX_BYTES) return Response.json({ error: "Image too large" }, { status: 413 });
    const bytes = await image.arrayBuffer();
    // PNG magic — we only ever serve back what claims to be (and parses as) PNG.
    const head = new Uint8Array(bytes.slice(0, 8));
    const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.byteLength >= 8 && magic.every((b, i) => head[i] === b)) {
      imageBytes = bytes;
      archive.hasImage = true;
    }
  }

  const id = randomId();
  await env.ARCHIVES.put(`a:${id}`, JSON.stringify(archive), { expirationTtl: TTL_SECONDS });
  if (imageBytes) {
    await env.ARCHIVES.put(`a:${id}:og`, imageBytes, { expirationTtl: TTL_SECONDS });
  }
  return Response.json({ id, url: `/a/${id}` }, { status: 201 });
}

export async function getArchive(env: Env, id: string): Promise<StoredArchive | null> {
  if (!/^[a-z2-9]{12}$/.test(id)) return null;
  return env.ARCHIVES.get<StoredArchive>(`a:${id}`, "json");
}

export async function handleArchiveGet(env: Env, id: string): Promise<Response> {
  const archive = await getArchive(env, id);
  if (!archive) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(archive, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}

export async function handleArchiveImage(env: Env, id: string): Promise<Response> {
  if (!/^[a-z2-9]{12}$/.test(id)) return new Response("Not found", { status: 404 });
  const bytes = await env.ARCHIVES.get(`a:${id}:og`, "arrayBuffer");
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
