import { describe, expect, it } from "vitest";
import type { ArchiveEntry } from "../shared/types";
import {
  getArchive,
  handleArchivePost,
  publishCompletedAiResult,
  validateArchive,
  type ArchiveEnv,
} from "../worker/archives";
import {
  putRendition,
  type AiR2Object,
  type AiR2PutOptions,
  type PostRoundAiResult,
} from "../worker/ai-jobs";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const PLAYER_ID = "00000000-0000-4000-8000-000000000011";

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

class MemoryKV {
  readonly values = new Map<string, string | ArrayBuffer>();

  async put(
    key: string,
    value: string | ArrayBuffer,
    _options?: { expirationTtl?: number },
  ): Promise<void> {
    this.values.set(
      key,
      typeof value === "string" ? value : value.slice(0),
    );
  }

  async get<T>(
    key: string,
    type?: "json" | "arrayBuffer" | "text",
  ): Promise<T | null> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    if (type === "arrayBuffer") {
      return (typeof value === "string"
        ? new TextEncoder().encode(value).buffer
        : value.slice(0)) as T;
    }
    const text =
      typeof value === "string" ? value : new TextDecoder().decode(value);
    return (type === "json" ? JSON.parse(text) : text) as T;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function setup() {
  const ARTWORK = new MemoryR2();
  const ARCHIVES = new MemoryKV();
  const env: ArchiveEnv = { ARTWORK, ARCHIVES };
  return { env, ARTWORK, ARCHIVES };
}

function critic() {
  return {
    title: "Untitled Emergency",
    subjectGuess: "penguin",
    confidence: 73,
    rating: 8,
    ratingTag: "Structurally optimistic",
    review: "A brave collision of feathers and municipal planning.",
    callout: { playerId: PLAYER_ID, text: "Blue has left the composition." },
    detective: { playerId: PLAYER_ID, reason: "Red drew around the truth." },
  };
}

function archiveEntry(
  ai: ArchiveEntry["ai"] | undefined = undefined,
): ArchiveEntry {
  return {
    roundNo: 1,
    word: "penguin",
    strokes: [
      {
        playerId: PLAYER_ID,
        colorIndex: 0,
        points: [0.1, 0.1, 0.8, 0.8],
      },
    ],
    outcome: "survived",
    fakeName: "Devon",
    fakeId: PLAYER_ID,
    criticSubjectMatched: ai?.critic ? true : undefined,
    criticDetectiveMatched: ai?.critic?.detective ? true : undefined,
    ai,
  };
}

function archiveMeta(entry: ArchiveEntry) {
  return {
    title: "Devon takes the gallery",
    players: [{ name: "Devon", colorIndex: 0, score: 4 }],
    entries: [entry],
  };
}

async function archiveRequest(entry: ArchiveEntry): Promise<Request> {
  const form = new FormData();
  form.set("meta", JSON.stringify(archiveMeta(entry)));
  const encoded = new Request("https://game.test/api/archives", {
    method: "POST",
    body: form,
  });
  const bytes = await encoded.arrayBuffer();
  return new Request(encoded.url, {
    method: "POST",
    body: bytes,
    headers: {
      "content-type": encoded.headers.get("content-type")!,
      "content-length": String(bytes.byteLength),
    },
  });
}

describe("published archive AI validation", () => {
  it("accepts legacy entries and bounded sanitized AI metadata", () => {
    expect(validateArchive(archiveMeta(archiveEntry()))?.entries[0].ai).toBeUndefined();

    const ai = {
      jobId: JOB_ID,
      criticStatus: "ready" as const,
      critic: critic(),
      renditionStatus: "ready" as const,
      renditionId: JOB_ID,
    };
    const stored = validateArchive(archiveMeta(archiveEntry(ai)));
    expect(stored?.entries[0]).toMatchObject({
      ai: {
        jobId: JOB_ID,
        criticStatus: "ready",
        critic: { title: "Untitled Emergency", rating: 8 },
        renditionStatus: "ready",
        renditionId: JOB_ID,
      },
      criticSubjectMatched: true,
      criticDetectiveMatched: true,
    });
  });

  it.each([
    ["bad rating", { ...critic(), rating: 11 }],
    ["oversized title", { ...critic(), title: "x".repeat(81) }],
    ["arbitrary URL field", { ...critic(), imageUrl: "https://evil.test/x" }],
  ])("rejects %s", (_label, badCritic) => {
    const ai = {
      jobId: JOB_ID,
      criticStatus: "ready" as const,
      critic: badCritic,
      renditionStatus: "ready" as const,
      renditionId: JOB_ID,
    };
    expect(validateArchive(archiveMeta(archiveEntry(ai)))).toBeNull();
  });

  it("rejects arbitrary rendition identifiers and non-boolean match flags", () => {
    const badId = archiveEntry({
      jobId: JOB_ID,
      criticStatus: "ready",
      critic: critic(),
      renditionStatus: "ready",
      renditionId: "https://evil.test/x",
    });
    expect(validateArchive(archiveMeta(badId))).toBeNull();

    const badMatch = {
      ...archiveEntry(),
      criticSubjectMatched: "yes",
    };
    expect(validateArchive(archiveMeta(badMatch as unknown as ArchiveEntry))).toBeNull();
  });
});

describe("published archives keep renditions private", () => {
  it("does not carry a ready rendition onto the public page", async () => {
    // The rendition is generated from a bitmap a player uploaded, which the
    // room never verifies against the real strokes. It may reach the table
    // that made it; it may not reach a permanent public URL on this domain.
    const { env, ARTWORK } = setup();
    await putRendition(env, JOB_ID, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const ready = archiveEntry({
      jobId: JOB_ID,
      criticStatus: "ready",
      critic: critic(),
      renditionStatus: "ready",
      renditionId: JOB_ID,
    });
    const response = await handleArchivePost(await archiveRequest(ready), env);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    const stored = await getArchive(env, id);
    expect(stored?.entries[0].ai).toMatchObject({
      criticStatus: "ready",
      renditionStatus: "unavailable",
      renditionId: null,
    });
    // Nothing was copied into a publicly derived key either.
    expect([...ARTWORK.objects.keys()].some((k) => k.includes(id))).toBe(false);
  });

  it("keeps the written verdict when a result lands after publication", async () => {
    const { env, ARCHIVES } = setup();
    const pending = archiveEntry({
      jobId: JOB_ID,
      criticStatus: "pending",
      critic: null,
      renditionStatus: "pending",
      renditionId: null,
    });
    const response = await handleArchivePost(
      await archiveRequest(pending),
      env,
    );
    const { id } = (await response.json()) as { id: string };
    expect(ARCHIVES.values.has(`ai-publish:${JOB_ID}`)).toBe(true);

    await putRendition(env, JOB_ID, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    const result: PostRoundAiResult = {
      jobId: JOB_ID,
      roundNo: 1,
      criticStatus: "ready",
      critic: critic(),
      renditionStatus: "ready",
      renditionId: JOB_ID,
      updatedAt: 1234,
    };
    await publishCompletedAiResult(env, result);

    expect(ARCHIVES.values.has(`ai-publish:${JOB_ID}`)).toBe(false);
    const stored = await getArchive(env, id);
    expect(stored?.entries[0]).toMatchObject({
      criticSubjectMatched: true,
      criticDetectiveMatched: true,
      ai: {
        criticStatus: "ready",
        critic: { title: "Untitled Emergency" },
        // Luna's words survive; her picture does not.
        renditionStatus: "unavailable",
        renditionId: null,
      },
    });
  });
});
