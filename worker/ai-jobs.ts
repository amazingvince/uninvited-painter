import type { AiTone, CriticVerdict } from "../shared/types";

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ARCHIVE_ID_RE = /^[a-z2-9]{12}$/;
const RESULT_KEYS = [
  "jobId",
  "roundNo",
  "criticStatus",
  "critic",
  "renditionStatus",
  "renditionId",
  "updatedAt",
] as const;
const VERDICT_KEYS = new Set([
  "title",
  "subjectGuess",
  "confidence",
  "rating",
  "ratingTag",
  "review",
  "callout",
  "detective",
]);

export interface PostRoundAiPayload {
  jobId: string;
  mode: "local" | "online";
  roomCode?: string;
  roundNo: number;
  word: string;
  tone: AiTone;
  criticEnabled: boolean;
  detectiveEnabled: boolean;
  artists: { id: string; color: string }[];
}

export interface PostRoundAiResult {
  jobId: string;
  roundNo: number;
  criticStatus: "pending" | "ready" | "unavailable";
  critic: CriticVerdict | null;
  renditionStatus: "pending" | "ready" | "unavailable";
  renditionId: string | null;
  updatedAt: number;
}

export interface AiR2PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
}

export interface AiR2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface AiR2Bucket {
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: AiR2PutOptions,
  ): Promise<unknown>;
  get(key: string): Promise<AiR2Object | null>;
}

export interface AiJobStoreEnv {
  ARTWORK: AiR2Bucket;
}

function assertJobId(jobId: string): void {
  if (!JOB_ID_RE.test(jobId)) throw new Error("Invalid AI job ID");
}

function assertArchiveId(archiveId: string): void {
  if (!ARCHIVE_ID_RE.test(archiveId)) throw new Error("Invalid archive ID");
}

function assertRoundNo(roundNo: number): void {
  if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > 99) {
    throw new Error("Invalid round number");
  }
}

export function jobSourceKey(jobId: string): string {
  assertJobId(jobId);
  return `jobs/${jobId}/source.png`;
}

export function jobStatusKey(jobId: string): string {
  assertJobId(jobId);
  return `jobs/${jobId}/status.json`;
}

export function jobRenditionKey(jobId: string): string {
  assertJobId(jobId);
  return `jobs/${jobId}/rendition.jpg`;
}

function jobPrivateKey(jobId: string): string {
  assertJobId(jobId);
  return `jobs/${jobId}/private`;
}

/**
 * Online jobs are delivered only through the room's redacted state broadcast,
 * which withholds the verdict until the reveal. Marking them private keeps the
 * public polling endpoint (a local-mode channel) from becoming a side door to
 * Luna's word guess mid-round.
 */
export async function markJobPrivate(
  env: AiJobStoreEnv,
  jobId: string,
): Promise<void> {
  await env.ARTWORK.put(jobPrivateKey(jobId), "1", {
    httpMetadata: { contentType: "text/plain" },
  });
}

export async function isJobPrivate(
  env: AiJobStoreEnv,
  jobId: string,
): Promise<boolean> {
  if (!JOB_ID_RE.test(jobId)) return true;
  return (await env.ARTWORK.get(jobPrivateKey(jobId))) !== null;
}

/**
 * A hard daily ceiling on paid image/critic jobs. The per-IP rate limiter
 * shapes bursts; this bounds the bill when someone brings many IPs. Counting
 * is best-effort (R2 read-modify-write can race under heavy concurrency) —
 * that is fine for a spend guard.
 */
export async function withinDailyAiBudget(
  env: AiJobStoreEnv,
  limit: number,
  now = Date.now(),
): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `budget/${day}`;
  let used = 0;
  try {
    const existing = await env.ARTWORK.get(key);
    if (existing) used = Number.parseInt(await existing.text(), 10) || 0;
  } catch {
    return true; // never let the meter itself break the game
  }
  if (used >= limit) return false;
  try {
    await env.ARTWORK.put(key, String(used + 1), {
      httpMetadata: { contentType: "text/plain" },
    });
  } catch {
    /* counting is best-effort */
  }
  return true;
}

export function archiveRenditionKey(
  archiveId: string,
  roundNo: number,
): string {
  assertArchiveId(archiveId);
  assertRoundNo(roundNo);
  return `archives/${archiveId}/round-${roundNo}-rendition.jpg`;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[] | Set<string>,
): boolean {
  const keys = allowed instanceof Set ? allowed : new Set(allowed);
  const required = allowed instanceof Set ? null : allowed;
  return Object.keys(value).every((key) => keys.has(key)) &&
    (required ? required.every((key) => Object.hasOwn(value, key)) : true);
}

function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    value === value.trim()
  );
}

function validAttribution(
  value: unknown,
  textKey: "text" | "reason",
): boolean {
  const item = object(value);
  return (
    item !== null &&
    exactKeys(item, ["playerId", textKey]) &&
    boundedText(item.playerId, 100) &&
    boundedText(item[textKey], 180)
  );
}

function validCritic(value: unknown): value is CriticVerdict {
  const critic = object(value);
  if (!critic || !exactKeys(critic, VERDICT_KEYS)) return false;
  if (
    critic.title !== undefined &&
    !boundedText(critic.title, 80)
  ) return false;
  if (
    critic.subjectGuess !== undefined &&
    !boundedText(critic.subjectGuess, 100)
  ) return false;
  if (
    critic.ratingTag !== undefined &&
    !boundedText(critic.ratingTag, 60)
  ) return false;
  if (
    critic.review !== undefined &&
    !boundedText(critic.review, 360)
  ) return false;
  if (
    critic.confidence !== undefined &&
    (!Number.isInteger(critic.confidence) ||
      (critic.confidence as number) < 0 ||
      (critic.confidence as number) > 100)
  ) return false;
  if (
    critic.rating !== undefined &&
    (!Number.isInteger(critic.rating) ||
      (critic.rating as number) < 1 ||
      (critic.rating as number) > 10)
  ) return false;
  if (
    critic.callout !== undefined &&
    !validAttribution(critic.callout, "text")
  ) return false;
  if (
    critic.detective !== undefined &&
    !validAttribution(critic.detective, "reason")
  ) return false;
  return Object.keys(critic).length > 0;
}

function validateResult(value: unknown): PostRoundAiResult | null {
  const result = object(value);
  if (!result || !exactKeys(result, RESULT_KEYS)) return null;
  if (
    typeof result.jobId !== "string" ||
    !JOB_ID_RE.test(result.jobId) ||
    !Number.isInteger(result.roundNo) ||
    (result.roundNo as number) < 1 ||
    (result.roundNo as number) > 99 ||
    typeof result.updatedAt !== "number" ||
    !Number.isFinite(result.updatedAt) ||
    result.updatedAt < 0
  ) {
    return null;
  }

  if (
    result.criticStatus !== "pending" &&
    result.criticStatus !== "ready" &&
    result.criticStatus !== "unavailable"
  ) return null;
  if (result.criticStatus === "ready") {
    if (!validCritic(result.critic)) return null;
  } else if (result.critic !== null) {
    return null;
  }

  if (
    result.renditionStatus !== "pending" &&
    result.renditionStatus !== "ready" &&
    result.renditionStatus !== "unavailable"
  ) return null;
  if (result.renditionStatus === "ready") {
    if (result.renditionId !== result.jobId) return null;
  } else if (result.renditionId !== null) {
    return null;
  }

  return {
    jobId: result.jobId,
    roundNo: result.roundNo as number,
    criticStatus: result.criticStatus,
    critic: result.criticStatus === "ready"
      ? (result.critic as CriticVerdict)
      : null,
    renditionStatus: result.renditionStatus,
    renditionId: result.renditionStatus === "ready"
      ? result.renditionId as string
      : null,
    updatedAt: result.updatedAt,
  };
}

const PRIVATE_PNG = {
  httpMetadata: {
    contentType: "image/png",
    cacheControl: "private, no-store",
  },
} satisfies AiR2PutOptions;

const PRIVATE_JPEG = {
  httpMetadata: {
    contentType: "image/jpeg",
    cacheControl: "private, no-store",
  },
} satisfies AiR2PutOptions;

const PRIVATE_JSON = {
  httpMetadata: {
    contentType: "application/json; charset=utf-8",
    cacheControl: "private, no-store",
  },
} satisfies AiR2PutOptions;

const PUBLIC_JPEG = {
  httpMetadata: {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=31536000, immutable",
  },
} satisfies AiR2PutOptions;

export async function putPendingJob(
  env: AiJobStoreEnv,
  payload: PostRoundAiPayload,
  updatedAt = Date.now(),
): Promise<PostRoundAiResult> {
  const result: PostRoundAiResult = {
    jobId: payload.jobId,
    roundNo: payload.roundNo,
    criticStatus: "pending",
    critic: null,
    renditionStatus: "pending",
    renditionId: null,
    updatedAt,
  };
  await putJobResult(env, result);
  return result;
}

export async function putJobResult(
  env: AiJobStoreEnv,
  result: PostRoundAiResult,
): Promise<void> {
  const clean = validateResult(result);
  if (!clean) throw new Error("Invalid AI job status");
  await env.ARTWORK.put(jobStatusKey(clean.jobId), JSON.stringify(clean), PRIVATE_JSON);
}

export async function getJob(
  env: AiJobStoreEnv,
  jobId: string,
): Promise<PostRoundAiResult | null> {
  const objectBody = await env.ARTWORK.get(jobStatusKey(jobId));
  if (!objectBody) return null;
  try {
    return validateResult(JSON.parse(await objectBody.text()));
  } catch {
    return null;
  }
}

export async function putSource(
  env: AiJobStoreEnv,
  jobId: string,
  png: ArrayBuffer,
): Promise<void> {
  await env.ARTWORK.put(jobSourceKey(jobId), png, PRIVATE_PNG);
}

export async function getSource(
  env: AiJobStoreEnv,
  jobId: string,
): Promise<ArrayBuffer | null> {
  const source = await env.ARTWORK.get(jobSourceKey(jobId));
  return source ? source.arrayBuffer() : null;
}

export async function putRendition(
  env: AiJobStoreEnv,
  jobId: string,
  jpeg: Uint8Array | ArrayBuffer,
): Promise<void> {
  await env.ARTWORK.put(jobRenditionKey(jobId), jpeg, PRIVATE_JPEG);
}

export async function getRendition(
  env: AiJobStoreEnv,
  jobId: string,
): Promise<ArrayBuffer | null> {
  const rendition = await env.ARTWORK.get(jobRenditionKey(jobId));
  return rendition ? rendition.arrayBuffer() : null;
}

export async function promoteRendition(
  env: AiJobStoreEnv,
  jobId: string,
  archiveId: string,
  roundNo: number,
): Promise<boolean> {
  const source = await env.ARTWORK.get(jobRenditionKey(jobId));
  const destination = archiveRenditionKey(archiveId, roundNo);
  if (!source) return false;
  await env.ARTWORK.put(destination, await source.arrayBuffer(), PUBLIC_JPEG);
  return true;
}
