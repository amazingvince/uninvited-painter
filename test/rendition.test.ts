import { describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../worker/ai-errors";
import {
  RENDITION_MAX_BYTES,
  renditionPrompt,
  requestRendition,
} from "../worker/rendition";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function imageResponse(encoded = base64(jpeg)): Response {
  return Response.json({ data: [{ b64_json: encoded }] });
}

describe("GPT Image 2 rendition request", () => {
  it("submits the exact edit contract and the preserve-the-weirdness prompt", async () => {
    let request: Request | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      request = new Request(input, init);
      return imageResponse();
    });

    const result = await requestRendition(
      {
        png: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
        word: "penguin",
      },
      { apiKey: "server-secret", fetchImpl },
    );

    expect([...result]).toEqual([...jpeg]);
    expect(request?.url).toBe("https://api.openai.com/v1/images/edits");
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe("Bearer server-secret");
    expect(request?.headers.get("content-type")).toMatch(/^multipart\/form-data;/);

    const form = await request?.formData();
    expect(form?.get("model")).toBe("gpt-image-2");
    expect(form?.get("size")).toBe("1024x1024");
    expect(form?.get("quality")).toBe("medium");
    expect(form?.get("output_format")).toBe("jpeg");
    expect(form?.get("output_compression")).toBe("85");
    expect(form?.get("moderation")).toBe("auto");
    expect(form?.has("input_fidelity")).toBe(false);
    expect(String(form?.get("prompt"))).toContain("penguin");
    // The prompt has to hold three lines at once, each tuned against real
    // games: keep the drawn geometry, don't draw the word competently, and
    // don't trip the provider's clothing filter on stick-figure torsos.
    expect(String(form?.get("prompt"))).toMatch(
      /fidelity to the drawing beats beauty/i,
    );
    expect(String(form?.get("prompt"))).toMatch(
      /never render a competent version/i,
    );
    expect(String(form?.get("prompt"))).toMatch(/fully clothed/i);

    const source = form?.get("image");
    expect(source).toBeInstanceOf(File);
    expect((source as File).name).toBe("drawing.png");
    expect((source as File).type).toBe("image/png");
  });

  it("accepts only a bounded authoritative word", () => {
    expect(renditionPrompt("  penguin  ")).toContain("“penguin”");
    expect(() => renditionPrompt("x")).toThrow(/word/i);
    expect(() => renditionPrompt("x".repeat(25))).toThrow(/word/i);
  });

  it("does not send unrelated game or critic information", async () => {
    let body = "";
    await requestRendition(
      { png: new Uint8Array([1]).buffer, word: "penguin" },
      {
        apiKey: "server-secret",
        fetchImpl: async (_input, init) => {
          body = await new Response(init?.body).text();
          return imageResponse();
        },
      },
    );
    expect(body).not.toContain("Devon");
    expect(body).not.toContain("fakeId");
    expect(body).not.toContain("rating");
    expect(body).not.toContain("server-secret");
  });
});

describe("GPT Image 2 response validation", () => {
  it.each([
    ["malformed base64", "not%%%base64"],
    ["non-JPEG bytes", base64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))],
    [
      "oversized output",
      "A".repeat(Math.ceil((RENDITION_MAX_BYTES * 4) / 3) + 8),
    ],
  ])("rejects %s", async (_label, encoded) => {
    await expect(
      requestRendition(
        { png: new Uint8Array([1]).buffer, word: "penguin" },
        {
          apiKey: "secret",
          fetchImpl: async () => imageResponse(encoded),
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_response",
      retryable: false,
    });
  });

  it("rejects a missing image payload", async () => {
    await expect(
      requestRendition(
        { png: new Uint8Array([1]).buffer, word: "penguin" },
        {
          apiKey: "secret",
          fetchImpl: async () => Response.json({ data: [] }),
        },
      ),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("GPT Image 2 error replay safety", () => {
  it.each([
    [400, "moderation_blocked"],
    [400, "image_generation_user_error"],
  ] as const)("marks HTTP %i / %s non-retryable", async (status, code) => {
    await expect(
      requestRendition(
        { png: new Uint8Array([1]).buffer, word: "penguin" },
        {
          apiKey: "secret",
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                error: {
                  code,
                  message: "penguin raw provider details",
                },
              }),
              {
                status,
                headers: { "x-request-id": "req_image_failure" },
              },
            ),
        },
      ),
    ).rejects.toMatchObject({
      code,
      retryable: false,
      requestId: "req_image_failure",
    });
  });

  it("marks an ambiguous network failure unsafe to replay automatically", async () => {
    await expect(
      requestRendition(
        { png: new Uint8Array([1]).buffer, word: "penguin" },
        {
          apiKey: "secret",
          fetchImpl: async () => {
            throw new TypeError("socket closed after upload");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "ambiguous_network_error",
      retryable: false,
    });
  });

  it("marks an image timeout unsafe to replay automatically", async () => {
    await expect(
      requestRendition(
        { png: new Uint8Array([1]).buffer, word: "penguin" },
        {
          apiKey: "secret",
          fetchImpl: async () => {
            throw new DOMException("aborted", "AbortError");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "timeout",
      retryable: false,
    });
  });
});
