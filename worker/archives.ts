// Published archives: a finished game's gallery gets a permanent public URL.
// The endpoint is unauthenticated, so the real defense is strict shape
// validation — a stored archive can only ever render as strokes, never as
// attacker-controlled markup.

import { parseCriticVerdict } from "../shared/criticVerdict";
import { AI_ID_RE as JOB_ID_RE } from "../shared/ids";
import { validSegments } from "../shared/geometry";
import { criticGuessMatches } from "../shared/fuzzy";
import { SEAT_COLORS } from "../shared/palette";
import type {
  ArchiveEntry,
  CriticVerdict,
  RoundAi,
} from "../shared/types";
import {
  getJob,
  type AiJobStoreEnv,
  type PostRoundAiResult,
} from "./ai-jobs";

const META_MAX_BYTES = 512 * 1024;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024; // still bounds the declared body
const TTL_SECONDS = 60 * 60 * 24 * 365; // archives live for a year
const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export interface ArchiveKv {
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { expirationTtl?: number },
  ): Promise<unknown>;
  get<T>(
    key: string,
    type?: "json" | "arrayBuffer" | "text",
  ): Promise<T | null>;
  delete(key: string): Promise<unknown>;
}

export interface ArchiveEnv extends AiJobStoreEnv {
  ARCHIVES: ArchiveKv;
}

export interface StoredArchive {
  title: string;
  players: { name: string; colorIndex: number; score: number }[];
  entries: ArchiveEntry[];
  createdAt: number;
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

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function cleanCritic(value: unknown): CriticVerdict | null {
  // Uploads are untrusted, but a verdict that merely names a departed artist
  // shouldn't lose its review — the shared parser drops the callout instead.
  const parsed = parseCriticVerdict(value);
  return typeof parsed === "string" ? null : parsed;
}

function cleanRoundAi(value: unknown): RoundAi | null {
  const ai = record(value);
  if (
    !ai ||
    !onlyKeys(ai, [
      "jobId",
      "criticStatus",
      "critic",
      "renditionStatus",
      "renditionId",
    ])
  ) {
    return null;
  }
  if (
    ai.jobId !== null &&
    (typeof ai.jobId !== "string" || !JOB_ID_RE.test(ai.jobId))
  ) {
    return null;
  }
  if (
    !["idle", "pending", "ready", "unavailable"].includes(
      String(ai.criticStatus),
    ) ||
    !["idle", "pending", "ready", "unavailable"].includes(
      String(ai.renditionStatus),
    )
  ) {
    return null;
  }
  const criticStatus = ai.criticStatus as RoundAi["criticStatus"];
  const renditionStatus = ai.renditionStatus as RoundAi["renditionStatus"];
  const critic = criticStatus === "ready" ? cleanCritic(ai.critic) : null;
  if (
    (criticStatus === "ready" && !critic) ||
    (criticStatus !== "ready" && ai.critic !== null)
  ) {
    return null;
  }
  if (
    renditionStatus === "ready"
      ? ai.renditionId !== ai.jobId || typeof ai.renditionId !== "string"
      : ai.renditionId !== null
  ) {
    return null;
  }
  if (
    ai.jobId === null &&
    (criticStatus !== "idle" || renditionStatus !== "idle")
  ) {
    return null;
  }
  return {
    jobId: ai.jobId as string | null,
    criticStatus,
    critic,
    renditionStatus,
    renditionId:
      renditionStatus === "ready" ? (ai.renditionId as string) : null,
  };
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
    let ai: RoundAi | undefined;
    if (e.ai !== undefined) {
      ai = cleanRoundAi(e.ai) ?? undefined;
      if (!ai) return null;
    }
    let fakeId: string | undefined;
    if (e.fakeId !== undefined) {
      if (typeof e.fakeId !== "string" || !JOB_ID_RE.test(e.fakeId)) {
        return null;
      }
      fakeId = e.fakeId;
    }
    if (
      e.criticSubjectMatched !== undefined &&
      typeof e.criticSubjectMatched !== "boolean"
    ) {
      return null;
    }
    if (
      e.criticDetectiveMatched !== undefined &&
      typeof e.criticDetectiveMatched !== "boolean"
    ) {
      return null;
    }
    entries.push({
      roundNo: e.roundNo as number,
      word,
      strokes,
      outcome: e.outcome as ArchiveEntry["outcome"],
      fakeName,
      ...(fakeId ? { fakeId } : {}),
      ...(ai ? { ai } : {}),
      ...(typeof e.criticSubjectMatched === "boolean"
        ? { criticSubjectMatched: e.criticSubjectMatched }
        : {}),
      ...(typeof e.criticDetectiveMatched === "boolean"
        ? { criticDetectiveMatched: e.criticDetectiveMatched }
        : {}),
    });
  }

  return { title, players, entries, createdAt: Date.now(), };
}

function archiveMappingKey(jobId: string): string {
  return `ai-publish:${jobId}`;
}

async function storeArchive(
  env: ArchiveEnv,
  id: string,
  archive: StoredArchive,
): Promise<void> {
  await env.ARCHIVES.put(`a:${id}`, JSON.stringify(archive), {
    expirationTtl: TTL_SECONDS,
  });
}

function resultIsSettled(result: PostRoundAiResult): boolean {
  return (
    result.criticStatus !== "pending" &&
    result.renditionStatus !== "pending"
  );
}

export async function publishCompletedAiResult(
  env: ArchiveEnv,
  result: PostRoundAiResult,
): Promise<void> {
  const mapping = await env.ARCHIVES.get<unknown>(
    archiveMappingKey(result.jobId),
    "json",
  );
  const value = record(mapping);
  if (
    !value ||
    !onlyKeys(value, ["archiveId", "roundNo"]) ||
    typeof value.archiveId !== "string" ||
    !/^[a-z2-9]{12}$/.test(value.archiveId) ||
    !Number.isInteger(value.roundNo) ||
    (value.roundNo as number) < 1 ||
    (value.roundNo as number) > 99
  ) {
    return;
  }
  const archiveId = value.archiveId;
  const roundNo = value.roundNo as number;
  const archive = await env.ARCHIVES.get<StoredArchive>(
    `a:${archiveId}`,
    "json",
  );
  const entry = archive?.entries.find(
    (candidate) => candidate.roundNo === roundNo,
  );
  if (!archive || !entry?.ai || entry.ai.jobId !== result.jobId) return;

  const critic =
    result.criticStatus === "ready" ? cleanCritic(result.critic) : null;
  const criticStatus =
    result.criticStatus === "ready" && critic
      ? "ready"
      : result.criticStatus === "pending"
        ? "pending"
        : "unavailable";

  entry.ai = {
    jobId: result.jobId,
    criticStatus,
    critic,
    // Published archives never carry a rendition; see handleArchivePost.
    renditionStatus: "unavailable",
    renditionId: null,
  };
  if (critic?.subjectGuess) {
    entry.criticSubjectMatched = criticGuessMatches(
      critic.subjectGuess,
      entry.word,
    );
  }
  if (critic?.detective && entry.fakeId) {
    entry.criticDetectiveMatched =
      critic.detective.playerId === entry.fakeId;
  }
  await storeArchive(env, archiveId, archive);
  if (resultIsSettled(result)) {
    await env.ARCHIVES.delete(archiveMappingKey(result.jobId));
  }
}

export async function handleArchivePost(
  request: Request,
  env: ArchiveEnv,
): Promise<Response> {
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

  // No uploaded image is kept. It only ever fed the link preview, and an
  // unauthenticated endpoint that mints a permanent public URL serving an
  // attacker's 2MB bitmap under this domain is not worth a nicer unfurl.
  const id = randomId();
  // Renditions stay off published pages. The image they are generated from is
  // a bitmap a player uploaded, which the room never verifies against the real
  // strokes — fine for the table that made it, not for a permanent public URL.
  // Luna's written verdict still travels: that is validated text.
  for (const entry of archive.entries) {
    if (!entry.ai) continue;
    entry.ai.renditionStatus = "unavailable";
    entry.ai.renditionId = null;
  }
  await storeArchive(env, id, archive);

  // Register pending jobs after the archive exists, then re-check the durable
  // job record to close the race where Workflow finished just before mapping.
  for (const entry of archive.entries) {
    const ai = entry.ai;
    if (
      !ai?.jobId ||
      (ai.criticStatus !== "pending" &&
        ai.renditionStatus !== "pending")
    ) {
      continue;
    }
    await env.ARCHIVES.put(
      archiveMappingKey(ai.jobId),
      JSON.stringify({ archiveId: id, roundNo: entry.roundNo }),
      { expirationTtl: TTL_SECONDS },
    );
    const completed = await getJob(env, ai.jobId);
    if (completed && resultIsSettled(completed)) {
      await publishCompletedAiResult(env, completed);
    }
  }
  return Response.json({ id, url: `/a/${id}` }, { status: 201 });
}

export async function getArchive(env: ArchiveEnv, id: string): Promise<StoredArchive | null> {
  if (!/^[a-z2-9]{12}$/.test(id)) return null;
  return env.ARCHIVES.get<StoredArchive>(`a:${id}`, "json");
}

export async function handleArchiveGet(env: ArchiveEnv, id: string): Promise<Response> {
  const archive = await getArchive(env, id);
  if (!archive) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(archive, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}


