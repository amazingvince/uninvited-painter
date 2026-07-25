import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getJob,
  jobStatusKey,
  putSource,
  type AiR2Object,
  type AiR2PutOptions,
  type PostRoundAiPayload,
  type PostRoundAiResult,
} from "../worker/ai-jobs";
import {
  runPostRoundAi,
  type PostRoundWorkflowEnv,
  type WorkflowStepConfigLike,
  type WorkflowStepLike,
} from "../worker/post-round-workflow";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const jpegBase64 = btoa(
  String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02),
);

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

class FakeStep implements WorkflowStepLike {
  readonly configs = new Map<string, WorkflowStepConfigLike>();
  readonly calls: string[] = [];

  async do<T>(
    name: string,
    config: WorkflowStepConfigLike,
    callback: () => Promise<T>,
  ): Promise<T> {
    this.calls.push(name);
    this.configs.set(name, config);
    return callback();
  }

  configFor(name: string): WorkflowStepConfigLike {
    const config = this.configs.get(name);
    if (!config) throw new Error(`No step named ${name}`);
    return config;
  }
}

function payload(mode: "local" | "online" = "local"): PostRoundAiPayload {
  return {
    jobId: JOB_ID,
    mode,
    ...(mode === "online" ? { roomCode: "MOLT" } : {}),
    roundNo: 1,
    word: "penguin",
    tone: "witty",
    criticEnabled: true,
    detectiveEnabled: true,
    artists: [
      { id: "p1", color: "#e84855" },
      { id: "p2", color: "#3b82f6" },
    ],
  };
}

function lunaResponse(): Response {
  return Response.json({
    output: [
      {
        content: [
          {
            type: "output_text",
            text: JSON.stringify({
              title: "Untitled Emergency",
              subjectGuess: "an anxious bird",
              confidence: 73,
              rating: 7,
              ratingTag: "Structurally optimistic",
              review: "A brave collision of feathers and municipal planning.",
              callout: null,
              detective: {
                playerId: "p1",
                reason: "Red knew too little and drew too much.",
              },
            }),
          },
        ],
      },
    ],
  });
}

function imageResponse(): Response {
  return Response.json({ data: [{ b64_json: jpegBase64 }] });
}

async function setup(
  mode: "local" | "online" = "local",
  apiKey: string | undefined = "secret",
) {
  const bucket = new MemoryR2();
  const roomNames: string[] = [];
  const completions: PostRoundAiResult[] = [];
  const env: PostRoundWorkflowEnv = {
    ARTWORK: bucket,
    OPENAI_API_KEY: apiKey,
    ROOM: {
      getByName(name) {
        roomNames.push(name);
        return {
          async completeAiJob(result) {
            completions.push(result);
          },
        };
      },
    },
  };
  await putSource(env, JOB_ID, new Uint8Array([1, 2, 3]).buffer);
  return {
    bucket,
    env,
    step: new FakeStep(),
    input: payload(mode),
    roomNames,
    completions,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("post-round AI workflow", () => {
  it("starts Luna and GPT Image 2 before waiting for either", async () => {
    const { env, step, input } = await setup();
    const starts: string[] = [];
    let releaseCritic!: (response: Response) => void;
    let releaseRendition!: (response: Response) => void;
    const critic = new Promise<Response>((resolve) => {
      releaseCritic = resolve;
    });
    const rendition = new Promise<Response>((resolve) => {
      releaseRendition = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request);
        if (url.endsWith("/responses")) {
          starts.push("critic");
          return critic;
        }
        starts.push("rendition");
        return rendition;
      }),
    );

    const running = runPostRoundAi(env, input, step);
    await vi.waitFor(() => expect(starts).toEqual(["critic", "rendition"]));
    releaseCritic(lunaResponse());
    releaseRendition(imageResponse());

    await expect(running).resolves.toMatchObject({
      jobId: JOB_ID,
      criticStatus: "ready",
      renditionStatus: "ready",
      renditionId: JOB_ID,
    });
    expect(step.configFor("prepare critic").retries?.limit).toBe(1);
    expect(step.configFor("generate rendition").retries?.limit).toBe(0);
  });

  it("keeps a successful rendition when Luna fails", async () => {
    const { env, step, input } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).endsWith("/responses")
          ? new Response(
              JSON.stringify({
                error: { code: "moderation_blocked", message: "blocked" },
              }),
              { status: 400 },
            )
          : imageResponse(),
      ),
    );

    const result = await runPostRoundAi(env, input, step);
    expect(result).toMatchObject({
      criticStatus: "unavailable",
      critic: null,
      renditionStatus: "ready",
      renditionId: JOB_ID,
    });
  });

  it("keeps a successful Luna verdict when rendition generation fails", async () => {
    const { env, step, input } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) => {
        if (String(request).endsWith("/responses")) return lunaResponse();
        throw new TypeError("ambiguous image upload failure");
      }),
    );

    const result = await runPostRoundAi(env, input, step);
    expect(result).toMatchObject({
      criticStatus: "ready",
      critic: { title: "Untitled Emergency" },
      renditionStatus: "unavailable",
      renditionId: null,
    });
    expect(await getJob(env, JOB_ID)).toEqual(result);
  });

  it("publishes both branches as unavailable when the key is missing", async () => {
    const { env, step, input } = await setup();
    delete env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runPostRoundAi(env, input, step);
    expect(result).toMatchObject({
      criticStatus: "unavailable",
      critic: null,
      renditionStatus: "unavailable",
      renditionId: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await getJob(env, JOB_ID)).toEqual(result);
  });

  it("publishes completion to only the named online room", async () => {
    const { env, step, input, roomNames, completions } = await setup("online");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).endsWith("/responses")
          ? lunaResponse()
          : imageResponse(),
      ),
    );

    const result = await runPostRoundAi(env, input, step);
    expect(roomNames).toEqual(["MOLT"]);
    expect(completions).toEqual([result]);
    expect(step.calls.at(-1)).toBe("publish result");
  });

  it("stores only the safe pollable result for local jobs", async () => {
    const { env, step, input, bucket, roomNames } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: RequestInfo | URL) =>
        String(request).endsWith("/responses")
          ? lunaResponse()
          : imageResponse(),
      ),
    );

    await runPostRoundAi(env, input, step);
    expect(roomNames).toEqual([]);
    const raw = await bucket.get(jobStatusKey(JOB_ID));
    const serialized = await raw?.text();
    expect(serialized).not.toContain("penguin");
    expect(serialized).not.toContain("source");
    expect(serialized).not.toContain("png");
    expect(serialized).not.toContain("OPENAI");
  });
});
