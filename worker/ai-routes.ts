import { activeArtists, aiEnabled } from "../shared/engine";
import { AI_ID_RE as JOB_ID_RE } from "../shared/ids";
import { SEAT_COLORS } from "../shared/palette";
import {
  HOUSE_WORD_MAX_LEN,
  type AiTone,
  type RoomState,
} from "../shared/types";
import {
  AI_MULTIPART_MAX_BYTES,
  validateReferencePng,
} from "./ai-input";
import {
  getJob,
  getRendition,
  isJobPrivate,
  putPendingJob,
  putSource,
  withinDailyAiBudget,
  type AiJobStoreEnv,
  type PostRoundAiPayload,
} from "./ai-jobs";

const META_MAX_BYTES = 16 * 1024;
/** Paid jobs per calendar day across the whole deployment. */
const DAILY_AI_JOB_LIMIT = 300;
const AI_TONES = new Set<AiTone>(["witty", "savage", "absurd"]);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

interface WorkflowCreateOptions {
  id?: string;
  params?: PostRoundAiPayload;
  retention?: {
    successRetention?: "1 day";
    errorRetention?: "1 day";
  };
}

interface OnlineRoomStub {
  startAiJob(
    token: string,
    roundNo: number,
    png: ArrayBuffer,
  ): Promise<{ jobId: string }>;
}

export interface AiRoutesEnv extends AiJobStoreEnv {
  AI_RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  POST_ROUND_AI: {
    create(options: WorkflowCreateOptions): Promise<unknown>;
  };
  ROOM: {
    getByName(code: string): OnlineRoomStub;
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function validJobId(jobId: string): boolean {
  return JOB_ID_RE.test(jobId);
}

function validRoundNo(roundNo: number): boolean {
  return Number.isInteger(roundNo) && roundNo >= 1 && roundNo <= 99;
}

function boundedWord(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const word = value.replace(/\s+/g, " ").trim();
  return word.length >= 2 && word.length <= HOUSE_WORD_MAX_LEN ? word : null;
}

function declaredMultipartOkay(request: Request): boolean {
  const declared = Number(request.headers.get("content-length"));
  return (
    Number.isFinite(declared) &&
    declared > 0 &&
    declared <= AI_MULTIPART_MAX_BYTES
  );
}

async function parseMultipart(request: Request): Promise<FormData | null> {
  if (!declaredMultipartOkay(request)) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function withinRateLimit(
  request: Request,
  env: AiRoutesEnv,
): Promise<boolean> {
  const key = request.headers.get("CF-Connecting-IP") ?? "local";
  return (await env.AI_RATE_LIMITER.limit({ key })).success;
}

function parseLocalPayload(meta: unknown): PostRoundAiPayload | null {
  const value = object(meta);
  if (
    !value ||
    !exactKeys(value, [
      "jobId",
      "roundNo",
      "word",
      "aiCritic",
      "aiDetective",
      "aiTone",
      "artists",
    ])
  ) {
    return null;
  }
  if (
    typeof value.jobId !== "string" ||
    !validJobId(value.jobId) ||
    typeof value.roundNo !== "number" ||
    !validRoundNo(value.roundNo) ||
    typeof value.aiCritic !== "boolean" ||
    typeof value.aiDetective !== "boolean" ||
    (!value.aiCritic && !value.aiDetective) ||
    typeof value.aiTone !== "string" ||
    !AI_TONES.has(value.aiTone as AiTone) ||
    !Array.isArray(value.artists) ||
    value.artists.length < 1 ||
    value.artists.length > SEAT_COLORS.length
  ) {
    return null;
  }
  const word = boundedWord(value.word);
  if (!word) return null;

  const seen = new Set<string>();
  const artists: PostRoundAiPayload["artists"] = [];
  for (const raw of value.artists) {
    const artist = object(raw);
    if (
      !artist ||
      !exactKeys(artist, ["id", "colorIndex"]) ||
      typeof artist.id !== "string" ||
      !validJobId(artist.id) ||
      seen.has(artist.id) ||
      !Number.isInteger(artist.colorIndex) ||
      (artist.colorIndex as number) < 0 ||
      (artist.colorIndex as number) >= SEAT_COLORS.length
    ) {
      return null;
    }
    seen.add(artist.id);
    artists.push({
      id: artist.id,
      color: SEAT_COLORS[artist.colorIndex as number],
    });
  }

  return {
    jobId: value.jobId,
    mode: "local",
    roundNo: value.roundNo,
    word,
    tone: value.aiTone as AiTone,
    criticEnabled: value.aiCritic,
    detectiveEnabled: value.aiDetective,
    artists,
  };
}

export function onlineAiPayload(
  state: RoomState,
  playerId: string,
  roundNo: number,
  jobId: string,
): PostRoundAiPayload {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("No active seat");
  const round = state.round;
  if (!round || round.roundNo !== roundNo) throw new Error("Wrong AI round");
  if (!["voting", "guessing", "reveal"].includes(state.phase)) {
    throw new Error("AI starts after drawing");
  }
  if (!aiEnabled(state.settings)) throw new Error("AI is disabled");
  if (round.outcome === "voided") throw new Error("Round was voided");
  const eligibleIds = activeArtists(round);
  if (!eligibleIds.includes(playerId)) throw new Error("No active seat");
  if (!validJobId(jobId)) throw new Error("Invalid AI job");

  return {
    jobId,
    mode: "online",
    roomCode: state.code,
    roundNo,
    word: round.word,
    tone: state.settings.aiTone,
    criticEnabled: state.settings.aiCritic,
    detectiveEnabled: state.settings.aiDetective,
    artists: eligibleIds.map((id) => {
      const artist = state.players.find((candidate) => candidate.id === id);
      if (!artist) throw new Error("Invalid round artist");
      return { id, color: SEAT_COLORS[artist.colorIndex] };
    }),
  };
}

async function imageFromForm(form: FormData): Promise<ArrayBuffer | null> {
  const image = form.get("image");
  if (!(image instanceof File) || image.type !== "image/png") return null;
  const png = await image.arrayBuffer();
  try {
    validateReferencePng(png);
    return png;
  } catch {
    return null;
  }
}

export async function handleLocalAiPost(
  request: Request,
  env: AiRoutesEnv,
): Promise<Response> {
  if (!declaredMultipartOkay(request)) {
    return json({ error: "Too large" }, 413);
  }
  if (!(await withinRateLimit(request, env))) {
    return json({ error: "AI is busy. Try again shortly." }, 429);
  }
  const form = await parseMultipart(request);
  if (!form) return json({ error: "Bad form data" }, 400);
  const rawMeta = form.get("meta");
  if (typeof rawMeta !== "string" || rawMeta.length > META_MAX_BYTES) {
    return json({ error: "Bad AI metadata" }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMeta);
  } catch {
    return json({ error: "Bad AI metadata" }, 400);
  }
  const payload = parseLocalPayload(parsed);
  if (!payload) return json({ error: "Bad AI metadata" }, 400);
  const png = await imageFromForm(form);
  if (!png) return json({ error: "Bad drawing image" }, 400);

  const existing = await getJob(env, payload.jobId);
  if (existing) return json(existing);

  // This endpoint is unauthenticated by design (pass-one-phone has no room),
  // so a spend ceiling backs up the per-IP limiter.
  if (!(await withinDailyAiBudget(env, DAILY_AI_JOB_LIMIT))) {
    return json({ error: "Luna has hit her daily gallery budget." }, 429);
  }

  await putSource(env, payload.jobId, png);
  const pending = await putPendingJob(env, payload);
  try {
    await env.POST_ROUND_AI.create({
      id: payload.jobId,
      params: payload,
      retention: {
        successRetention: "1 day",
        errorRetention: "1 day",
      },
    });
  } catch {
    // Stable Workflow IDs make a concurrent duplicate harmless. If pending
    // state exists, the original instance owns the work.
    const concurrent = await getJob(env, payload.jobId);
    if (!concurrent) return json({ error: "Could not start AI" }, 503);
  }
  return json(pending, 202);
}

export async function handleOnlineAiPost(
  request: Request,
  env: AiRoutesEnv,
  code: string,
): Promise<Response> {
  if (!declaredMultipartOkay(request)) {
    return json({ error: "Too large" }, 413);
  }
  if (!(await withinRateLimit(request, env))) {
    return json({ error: "AI is busy. Try again shortly." }, 429);
  }
  const form = await parseMultipart(request);
  if (!form) return json({ error: "Bad form data" }, 400);
  const token = form.get("token");
  const rawRoundNo = form.get("roundNo");
  if (
    typeof token !== "string" ||
    token.length < 1 ||
    token.length > 64 ||
    typeof rawRoundNo !== "string" ||
    !/^[1-9][0-9]?$/.test(rawRoundNo)
  ) {
    return json({ error: "Bad AI request" }, 400);
  }
  const png = await imageFromForm(form);
  if (!png) return json({ error: "Bad drawing image" }, 400);

  try {
    await env.ROOM.getByName(code).startAiJob(token, Number(rawRoundNo), png);
    // Deliberately no jobId in the reply: online results reach players only
    // through the room's redacted broadcast, which withholds Luna's guess
    // until the reveal. Handing the id back would let the fake artist poll it.
    return json({ ok: true }, 202);
  } catch {
    return json({ error: "AI could not start for this round" }, 400);
  }
}

export async function handleAiStatus(
  env: AiJobStoreEnv,
  jobId: string,
): Promise<Response> {
  if (!validJobId(jobId)) return json({ error: "Bad AI job" }, 400);
  // Online jobs are room-private — the DO broadcast is their only channel.
  if (await isJobPrivate(env, jobId)) return json({ error: "Not found" }, 404);
  const result = await getJob(env, jobId);
  return result ? json(result) : json({ error: "Not found" }, 404);
}

export async function handleAiRendition(
  env: AiJobStoreEnv,
  renditionId: string,
): Promise<Response> {
  if (!validJobId(renditionId)) {
    return json({ error: "Bad rendition" }, 400);
  }
  const jpeg = await getRendition(env, renditionId);
  if (!jpeg) return json({ error: "Not found" }, 404);
  const head = new Uint8Array(jpeg, 0, Math.min(3, jpeg.byteLength));
  if (
    head.length !== 3 ||
    head[0] !== 0xff ||
    head[1] !== 0xd8 ||
    head[2] !== 0xff
  ) {
    return json({ error: "Not found" }, 404);
  }
  return new Response(jpeg, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
