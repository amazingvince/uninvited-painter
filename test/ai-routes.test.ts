import { describe, expect, it } from "vitest";
import {
  createRoom,
  currentDrawerId,
  reduce,
} from "../shared/engine";
import type { GameEvent, RoomState, Settings } from "../shared/types";
import {
  handleAiRendition,
  handleAiStatus,
  handleLocalAiPost,
  handleOnlineAiPost,
  onlineAiPayload,
  type AiRoutesEnv,
} from "../worker/ai-routes";
import {
  getJob,
  putRendition,
  type AiR2Object,
  type AiR2PutOptions,
  type PostRoundAiPayload,
} from "../worker/ai-jobs";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const PLAYER_IDS = [
  "00000000-0000-4000-8000-000000000011",
  "00000000-0000-4000-8000-000000000012",
  "00000000-0000-4000-8000-000000000013",
  "00000000-0000-4000-8000-000000000014",
  "00000000-0000-4000-8000-000000000015",
];

class MemoryR2 {
  readonly objects = new Map<
    string,
    { bytes: ArrayBuffer; options?: AiR2PutOptions }
  >();

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: AiR2PutOptions,
  ): Promise<void> {
    let bytes: ArrayBuffer;
    if (typeof value === "string") {
      bytes = new TextEncoder().encode(value).buffer;
    } else if (ArrayBuffer.isView(value)) {
      bytes = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer;
    } else {
      bytes = value.slice(0);
    }
    this.objects.set(key, { bytes, options });
  }

  async get(key: string): Promise<AiR2Object | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return {
      arrayBuffer: async () => stored.bytes.slice(0),
      text: async () => new TextDecoder().decode(stored.bytes),
    };
  }
}

function setup(rateLimit = true) {
  const bucket = new MemoryR2();
  const workflows: Array<{
    id?: string;
    params?: PostRoundAiPayload;
    retention?: unknown;
  }> = [];
  const onlineStarts: Array<{
    code: string;
    token: string;
    roundNo: number;
    png: ArrayBuffer;
  }> = [];
  const env: AiRoutesEnv = {
    ARTWORK: bucket,
    AI_RATE_LIMITER: {
      async limit() {
        return { success: rateLimit };
      },
    },
    POST_ROUND_AI: {
      async create(options) {
        workflows.push(options);
        return {};
      },
    },
    ROOM: {
      getByName(code) {
        return {
          async startAiJob(token, roundNo, png) {
            onlineStarts.push({ code, token, roundNo, png });
            return { jobId: JOB_ID };
          },
        };
      },
    },
  };
  return { bucket, env, workflows, onlineStarts };
}

function png1024(): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1024);
  view.setUint32(20, 1024);
  return bytes;
}

function localMeta(overrides: Record<string, unknown> = {}) {
  return {
    jobId: JOB_ID,
    roundNo: 1,
    word: "penguin",
    aiCritic: true,
    aiDetective: false,
    aiTone: "witty",
    artists: PLAYER_IDS.map((id, colorIndex) => ({ id, colorIndex })),
    ...overrides,
  };
}

async function multipartRequest(
  url: string,
  values: Record<string, string | Blob>,
): Promise<Request> {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value instanceof Blob) form.set(key, value, "drawing.png");
    else form.set(key, value);
  }
  const encoded = new Request(url, { method: "POST", body: form });
  const bytes = await encoded.arrayBuffer();
  return new Request(url, {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
      "CF-Connecting-IP": "203.0.113.4",
    },
  });
}

function localRequest(meta = localMeta()): Promise<Request> {
  return multipartRequest("https://game.test/api/ai/jobs", {
    meta: JSON.stringify(meta),
    image: new Blob([png1024().buffer as ArrayBuffer], { type: "image/png" }),
  });
}

function apply(state: RoomState, event: GameEvent): RoomState {
  const result = reduce(state, event);
  if (!result.ok) throw new Error(`${event.type}: ${result.error}`);
  return result.state;
}

function roomAtVoting(settings: Partial<Settings> = {}): RoomState {
  let state = createRoom({
    code: "MOLT",
    mode: "online",
    hostId: "",
    settings: { qmMode: "off", passes: 1, ...settings },
  });
  for (let index = 0; index < PLAYER_IDS.length; index += 1) {
    state = apply(state, {
      type: "ADD_PLAYER",
      player: {
        id: PLAYER_IDS[index],
        name: `Player ${index}`,
        colorIndex: index,
      },
    });
  }
  state = apply(state, {
    type: "START_ROUND",
    word: "penguin",
    category: "Animals",
    qmId: null,
    fakeId: PLAYER_IDS[0],
    turnOrder: PLAYER_IDS,
  });
  for (const id of PLAYER_IDS) {
    state = apply(state, { type: "MARK_SEEN", playerId: id, now: 0 });
  }
  while (state.phase === "drawing") {
    state = apply(state, {
      type: "COMMIT_STROKE",
      playerId: currentDrawerId(state)!,
      points: [0.1, 0.1, 0.5, 0.5, 0.9, 0.9],
      now: 0,
    });
  }
  return state;
}

describe("local AI start route", () => {
  it("rejects missing and oversized lengths before parsing multipart", async () => {
    const { env } = setup();
    const missing = new Request("https://game.test/api/ai/jobs", {
      method: "POST",
      body: "not multipart",
    });
    expect((await handleLocalAiPost(missing, env)).status).toBe(413);

    const oversized = new Request("https://game.test/api/ai/jobs", {
      method: "POST",
      body: "not multipart",
      headers: { "content-length": String(3 * 1024 * 1024) },
    });
    expect((await handleLocalAiPost(oversized, env)).status).toBe(413);
  });

  it("rejects rate-limited starts", async () => {
    const { env } = setup(false);
    expect((await handleLocalAiPost(await localRequest(), env)).status).toBe(429);
  });

  it.each([
    ["job ID", { jobId: "bad" }],
    ["round", { roundNo: 0 }],
    ["tone", { aiTone: "mean" }],
    ["word", { word: "x" }],
    ["artist ID", { artists: [{ id: "bad", colorIndex: 0 }] }],
    ["artist color", { artists: [{ id: PLAYER_IDS[0], colorIndex: 99 }] }],
  ])("rejects a bad %s", async (_label, override) => {
    const { env } = setup();
    const response = await handleLocalAiPost(
      await localRequest(localMeta(override)),
      env,
    );
    expect(response.status).toBe(400);
  });

  it("stores pending state and starts one stable workflow", async () => {
    const { env, workflows } = setup();
    const first = await handleLocalAiPost(await localRequest(), env);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ jobId: JOB_ID });
    expect(await getJob(env, JOB_ID)).toMatchObject({
      criticStatus: "pending",
      renditionStatus: "pending",
    });
    expect(workflows).toHaveLength(1);
    expect(workflows[0]).toMatchObject({
      id: JOB_ID,
      params: {
        jobId: JOB_ID,
        mode: "local",
        word: "penguin",
        tone: "witty",
      },
      retention: {
        successRetention: "1 day",
        errorRetention: "1 day",
      },
    });

    const repeat = await handleLocalAiPost(await localRequest(), env);
    expect(repeat.status).toBe(200);
    expect(workflows).toHaveLength(1);
  });
});

describe("AI status and rendition routes", () => {
  it("returns only sanitized pollable job state", async () => {
    const { env } = setup();
    await handleLocalAiPost(await localRequest(), env);
    const response = await handleAiStatus(env, JOB_ID);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("penguin");
    expect(text).not.toContain("provider");
    expect(text).not.toContain("artists");
  });

  it("serves only UUID-addressed validated private JPEGs", async () => {
    const { env } = setup();
    expect((await handleAiRendition(env, "bad")).status).toBe(400);
    expect((await handleAiRendition(env, JOB_ID)).status).toBe(404);

    await putRendition(
      env,
      JOB_ID,
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    );
    const response = await handleAiRendition(env, JOB_ID);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer()).slice(0, 3)).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    );
  });
});

describe("online AI ownership boundary", () => {
  it("accepts only token, round, and PNG from the browser", async () => {
    const { env, onlineStarts } = setup();
    const request = await multipartRequest(
      "https://game.test/api/rooms/MOLT/ai",
      {
        token: "seat-token",
        roundNo: "1",
        image: new Blob([png1024().buffer as ArrayBuffer], {
          type: "image/png",
        }),
      },
    );
    const response = await handleOnlineAiPost(request, env, "MOLT");
    expect(response.status).toBe(202);
    expect(onlineStarts).toHaveLength(1);
    expect(onlineStarts[0]).toMatchObject({
      code: "MOLT",
      token: "seat-token",
      roundNo: 1,
    });
  });

  it("derives the word, settings, IDs, and colors from room state", () => {
    const state = roomAtVoting({ aiTone: "absurd", aiDetective: true });
    const payload = onlineAiPayload(state, PLAYER_IDS[2], 1, JOB_ID);
    expect(payload).toMatchObject({
      jobId: JOB_ID,
      mode: "online",
      roomCode: "MOLT",
      roundNo: 1,
      word: "penguin",
      tone: "absurd",
      criticEnabled: true,
      detectiveEnabled: true,
    });
    expect(payload.artists).toHaveLength(5);
    expect(payload.artists.slice(0, 2)).toEqual([
      { id: PLAYER_IDS[0], color: "#1b4a8a" },
      { id: PLAYER_IDS[1], color: "#d92b1f" },
    ]);
    expect(JSON.stringify(payload)).not.toContain("Player 2");
  });

  it("rejects unknown seats, wrong rounds, pre-voting, disabled AI, and voided rounds", () => {
    const voting = roomAtVoting();
    expect(() => onlineAiPayload(voting, "unknown", 1, JOB_ID)).toThrow(/seat/i);
    expect(() =>
      onlineAiPayload(voting, PLAYER_IDS[1], 2, JOB_ID),
    ).toThrow(/round/i);

    const drawing = createRoom({ code: "MOLT", mode: "online", hostId: "" });
    expect(() =>
      onlineAiPayload(drawing, PLAYER_IDS[1], 1, JOB_ID),
    ).toThrow();

    const disabled = roomAtVoting({ aiCritic: false, aiDetective: false });
    expect(() =>
      onlineAiPayload(disabled, PLAYER_IDS[1], 1, JOB_ID),
    ).toThrow(/disabled/i);

    const voided = structuredClone(voting);
    voided.round!.outcome = "voided";
    expect(() =>
      onlineAiPayload(voided, PLAYER_IDS[1], 1, JOB_ID),
    ).toThrow(/voided/i);
  });
});
