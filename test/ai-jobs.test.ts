import { describe, expect, it } from "vitest";
import type { CriticVerdict } from "../shared/types";
import {
  getJob,
  getRendition,
  getSource,
  jobRenditionKey,
  jobSourceKey,
  jobStatusKey,
  putJobResult,
  putPendingJob,
  putRendition,
  putSource,
  withinDailyAiBudget,
  withinDailyIpBudget,
  type AiR2Object,
  type AiR2PutOptions,
  type PostRoundAiPayload,
  type PostRoundAiResult,
} from "../worker/ai-jobs";

const JOB_ID = "00000000-0000-4000-8000-000000000001";

interface StoredObject {
  bytes: ArrayBuffer;
  options?: AiR2PutOptions;
}

class MemoryR2 {
  readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: AiR2PutOptions,
  ): Promise<null> {
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
    return null;
  }

  async get(key: string): Promise<AiR2Object | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = stored.bytes.slice(0);
    return {
      arrayBuffer: async () => bytes.slice(0),
      text: async () => new TextDecoder().decode(bytes),
    };
  }
}

function setup() {
  const bucket = new MemoryR2();
  return {
    bucket,
    env: { ARTWORK: bucket },
  };
}

function payload(): PostRoundAiPayload {
  return {
    jobId: JOB_ID,
    mode: "local",
    roundNo: 2,
    word: "penguin",
    tone: "witty",
    criticEnabled: true,
    detectiveEnabled: false,
    artists: [
      { id: "p1", color: "#e84855" },
      { id: "p2", color: "#3b82f6" },
    ],
  };
}

function critic(): CriticVerdict {
  return {
    title: "Untitled Emergency",
    subjectGuess: "an anxious bird",
    confidence: 73,
    rating: 7,
    ratingTag: "Structurally optimistic",
    review: "A brave collision of feathers and municipal planning.",
    callout: { playerId: "p2", text: "Blue has left the composition." },
  };
}

function result(): PostRoundAiResult {
  return {
    jobId: JOB_ID,
    roundNo: 2,
    criticStatus: "ready",
    critic: critic(),
    renditionStatus: "ready",
    renditionId: JOB_ID,
    updatedAt: 1_753_459_200_000,
  };
}

describe("private AI job store", () => {
  it("stores source, status and rendition objects", async () => {
    const { env } = setup();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    await putSource(env, JOB_ID, png);
    expect(new Uint8Array((await getSource(env, JOB_ID))!)).toEqual(
      new Uint8Array(png),
    );

    await putJobResult(env, result());
    expect(await getJob(env, JOB_ID)).toEqual(result());

    await putRendition(env, JOB_ID, jpeg);
    expect(new Uint8Array((await getRendition(env, JOB_ID))!)).toEqual(jpeg);
  });

  it("persists a public-safe pending record without the payload word", async () => {
    const { env, bucket } = setup();
    const pending = await putPendingJob(env, payload(), 1234);

    expect(pending).toEqual({
      jobId: JOB_ID,
      roundNo: 2,
      criticStatus: "pending",
      critic: null,
      renditionStatus: "pending",
      renditionId: null,
      updatedAt: 1234,
    });
    const raw = await bucket.get(jobStatusKey(JOB_ID));
    const text = await raw?.text();
    expect(text).not.toContain("penguin");
    expect(text).not.toContain("word");
    expect(text).not.toContain("name");
    expect(text).not.toContain("artists");
  });

  it("writes exact content types and cache metadata", async () => {
    const { env, bucket } = setup();
    await putSource(env, JOB_ID, new Uint8Array([1]).buffer);
    await putJobResult(env, result());
    await putRendition(env, JOB_ID, new Uint8Array([0xff, 0xd8, 0xff]));

    expect(bucket.objects.get(jobSourceKey(JOB_ID))?.options?.httpMetadata).toEqual({
      contentType: "image/png",
      cacheControl: "private, no-store",
    });
    expect(bucket.objects.get(jobStatusKey(JOB_ID))?.options?.httpMetadata).toEqual({
      contentType: "application/json; charset=utf-8",
      cacheControl: "private, no-store",
    });
    expect(bucket.objects.get(jobRenditionKey(JOB_ID))?.options?.httpMetadata).toEqual({
      contentType: "image/jpeg",
      cacheControl: "private, no-store",
    });
  });

  it("rejects invalid identifiers and status shapes", async () => {
    const { env } = setup();
    await expect(putSource(env, "bad-id", new ArrayBuffer(0))).rejects.toThrow(
      /job/i,
    );
    await expect(
      putJobResult(env, {
        ...result(),
        criticStatus: "ready",
        critic: null,
      }),
    ).rejects.toThrow(/status/i);
    await expect(
      putJobResult(env, { ...result(), renditionId: "another-id" }),
    ).rejects.toThrow(/status/i);
  });

  it("returns null for missing or corrupted objects", async () => {
    const { env, bucket } = setup();
    expect(await getSource(env, JOB_ID)).toBeNull();
    expect(await getRendition(env, JOB_ID)).toBeNull();
    expect(await getJob(env, JOB_ID)).toBeNull();

    await bucket.put(jobStatusKey(JOB_ID), "{not json");
    expect(await getJob(env, JOB_ID)).toBeNull();
    await bucket.put(jobStatusKey(JOB_ID), JSON.stringify({ ...result(), word: "penguin" }));
    expect(await getJob(env, JOB_ID)).toBeNull();
  });
});

describe("daily spend guards", () => {
  it("meters each caller separately and refuses once spent", async () => {
    const { env } = setup();
    const day = Date.UTC(2026, 6, 25, 12);
    for (let i = 0; i < 3; i++) {
      expect(await withinDailyIpBudget(env, "1.2.3.4", 3, day)).toBe(true);
    }
    expect(await withinDailyIpBudget(env, "1.2.3.4", 3, day)).toBe(false);
    // A different caller has their own allowance...
    expect(await withinDailyIpBudget(env, "5.6.7.8", 3, day)).toBe(true);
    // ...and so does the same caller tomorrow.
    expect(await withinDailyIpBudget(env, "1.2.3.4", 3, day + 86_400_000)).toBe(true);
  });

  it("never writes the caller's address, only a hash of it", async () => {
    const { env, bucket } = setup();
    await withinDailyIpBudget(env, "203.0.113.9", 5, Date.UTC(2026, 6, 25));
    const keys = [...bucket.objects.keys()].join(" ");
    expect(keys).not.toContain("203.0.113.9");
    expect(keys).toMatch(/caller-[0-9a-f]{20}/);
  });

  it("keeps the global ceiling independent of any one caller", async () => {
    const { env } = setup();
    const day = Date.UTC(2026, 6, 25);
    expect(await withinDailyAiBudget(env, 1, day)).toBe(true);
    expect(await withinDailyAiBudget(env, 1, day)).toBe(false);
    expect(await withinDailyIpBudget(env, "1.2.3.4", 5, day)).toBe(true);
  });
});
