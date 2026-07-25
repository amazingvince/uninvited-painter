import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../worker/ai-errors";
import {
  requestCritic,
  sanitizeCriticVerdict,
  type CriticInput,
} from "../worker/critic";

const artists = [
  { id: "p1", color: "#e84855" },
  { id: "p2", color: "#3b82f6" },
];

const fullInput: CriticInput = {
  png: new Uint8Array([1, 2, 3]).buffer,
  tone: "witty",
  criticEnabled: true,
  detectiveEnabled: true,
  artists,
};

function verdict(overrides: Record<string, unknown> = {}) {
  return {
    title: "Untitled Emergency",
    subjectGuess: "an anxious bird",
    confidence: 73,
    rating: 7,
    ratingTag: "Structurally optimistic",
    review: "A brave collision of feathers and municipal planning.",
    callout: {
      playerId: "p2",
      text: "The blue line has filed for independence.",
    },
    detective: {
      playerId: "p1",
      reason: "Red knew too little and drew too much.",
    },
    ...overrides,
  };
}

function responseWith(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify(payload),
            },
          ],
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req_ok" },
    },
  );
}

describe("Luna request contract", () => {
  it.each(["witty", "savage", "absurd"] as const)(
    "uses Luna 5.6, low reasoning, strict output, and anonymous input in %s mode",
    async (tone) => {
      let request: Request | undefined;
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        request = new Request(input, init);
        return responseWith(verdict());
      });

      await requestCritic(
        { ...fullInput, tone },
        { apiKey: "server-secret", fetchImpl },
      );

      expect(request?.url).toBe("https://api.openai.com/v1/responses");
      expect(request?.method).toBe("POST");
      expect(request?.headers.get("authorization")).toBe("Bearer server-secret");
      const body = (await request?.json()) as {
        model: string;
        reasoning: unknown;
        max_output_tokens: number;
        input: unknown;
        text: {
          format: {
            type: string;
            strict: boolean;
            schema: { required: string[] };
          };
        };
      };
      expect(body.model).toBe("gpt-5.6-luna");
      expect(body.reasoning).toEqual({ effort: "low" });
      expect(body.max_output_tokens).toBe(700);
      expect(body.text.format.type).toBe("json_schema");
      expect(body.text.format.strict).toBe(true);
      expect(body.text.format.schema.required).toEqual([
        "title",
        "subjectGuess",
        "confidence",
        "rating",
        "ratingTag",
        "review",
        "callout",
        "detective",
      ]);

      const serialized = JSON.stringify(body);
      expect(serialized).toContain(tone);
      expect(serialized).toContain("data:image/png;base64,AQID");
      expect(serialized).toContain("p2");
      expect(serialized).toContain("#3b82f6");
      expect(serialized).not.toContain("penguin");
      expect(serialized).not.toContain("Devon");
      expect(serialized).not.toContain("fakeId");
      expect(serialized).not.toContain("server-secret");
    },
  );

  it("allows a server-only model override", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        responseWith(verdict()),
    );
    await requestCritic(fullInput, {
      apiKey: "secret",
      model: "critic-canary",
      fetchImpl,
    });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(JSON.parse(String(init?.body)).model).toBe("critic-canary");
  });

  it("omits disabled output sections", async () => {
    const criticOnly = await requestCritic(
      { ...fullInput, detectiveEnabled: false },
      {
        apiKey: "secret",
        fetchImpl: async () => responseWith(verdict({ detective: null })),
      },
    );
    expect(criticOnly.title).toBe("Untitled Emergency");
    expect(criticOnly.detective).toBeUndefined();

    const detectiveOnly = await requestCritic(
      { ...fullInput, criticEnabled: false },
      {
        apiKey: "secret",
        fetchImpl: async () =>
          responseWith(
            verdict({
              title: null,
              subjectGuess: null,
              confidence: null,
              rating: null,
              ratingTag: null,
              review: null,
              callout: null,
            }),
          ),
      },
    );
    expect(detectiveOnly).toEqual({
      detective: {
        playerId: "p1",
        reason: "Red knew too little and drew too much.",
      },
    });
  });
});

describe("Luna verdict sanitizer", () => {
  it("normalizes whitespace and caps stored strings", () => {
    const clean = sanitizeCriticVerdict(
      verdict({
        title: `  ${"x".repeat(100)}  `,
        review: "  One\n\tstrange   bird.  ",
      }),
      fullInput,
    );
    expect(clean.title).toHaveLength(80);
    expect(clean.review).toBe("One strange bird.");
  });

  it("drops invalid optional callouts but requires an eligible detective", () => {
    const criticOnly = sanitizeCriticVerdict(
      verdict({
        callout: { playerId: "intruder", text: "Nope." },
        detective: null,
      }),
      { ...fullInput, detectiveEnabled: false },
    );
    expect(criticOnly.callout).toBeUndefined();

    expect(() =>
      sanitizeCriticVerdict(
        verdict({
          detective: { playerId: "intruder", reason: "Definitely suspicious." },
        }),
        fullInput,
      ),
    ).toThrow(AiProviderError);
  });

  it("rejects missing enabled sections and out-of-range integers", () => {
    expect(() =>
      sanitizeCriticVerdict(verdict({ title: null }), fullInput),
    ).toThrow(/critic/i);
    expect(() =>
      sanitizeCriticVerdict(verdict({ detective: null }), fullInput),
    ).toThrow(/detective/i);
    expect(() =>
      sanitizeCriticVerdict(verdict({ rating: 11 }), fullInput),
    ).toThrow(/rating/i);
    expect(() =>
      sanitizeCriticVerdict(verdict({ confidence: 101 }), fullInput),
    ).toThrow(/confidence/i);
  });

  it("rejects malformed structured output", async () => {
    await expect(
      requestCritic(fullInput, {
        apiKey: "secret",
        fetchImpl: async () => responseWith({ title: "Only a title" }),
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
    });

    await expect(
      requestCritic(fullInput, {
        apiKey: "secret",
        fetchImpl: async () =>
          new Response(JSON.stringify({ output: [] }), { status: 200 }),
      }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
    });
  });
});

describe("Luna provider errors", () => {
  it.each([
    [401, "invalid_api_key", false],
    [429, "rate_limit_exceeded", true],
    [500, "server_error", true],
    [400, "moderation_blocked", false],
  ] as const)(
    "classifies HTTP %i / %s without leaking provider text",
    async (status, code, retryable) => {
      const unsafeMessage = "penguin Devon raw provider details";
      const promise = requestCritic(fullInput, {
        apiKey: "secret",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ error: { code, message: unsafeMessage } }),
            {
              status,
              headers: {
                "content-type": "application/json",
                "x-request-id": "req_failure",
              },
            },
          ),
      });

      await expect(promise).rejects.toMatchObject({
        code,
        retryable,
        requestId: "req_failure",
      });
      await expect(promise).rejects.not.toHaveProperty(
        "message",
        expect.stringContaining("penguin"),
      );
    },
  );

  it("classifies aborts as retryable timeouts", async () => {
    await expect(
      requestCritic(fullInput, {
        apiKey: "secret",
        fetchImpl: async () => {
          throw new DOMException("aborted", "AbortError");
        },
      }),
    ).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    });
  });
});
