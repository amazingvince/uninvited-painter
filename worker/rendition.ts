import { HOUSE_WORD_MAX_LEN } from "../shared/types";
import {
  AiProviderError,
  providerResponseError,
} from "./ai-errors";

const IMAGE_EDITS_URL = "https://api.openai.com/v1/images/edits";
const IMAGE_TIMEOUT_MS = 150_000;

export const RENDITION_MAX_BYTES = 8 * 1024 * 1024;

export interface RenditionInput {
  png: ArrayBuffer;
  word: string;
}

export interface RenditionConfig {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalid(message: string): AiProviderError {
  return new AiProviderError(message, "invalid_response", false);
}

function cleanWord(value: string): string {
  // House-deck words are player-written and land inside the prompt, so strip
  // anything that could close the quote and start giving instructions.
  const word = value
    .replace(/[^\p{L}\p{N} '\-&.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (word.length < 2 || word.length > HOUSE_WORD_MAX_LEN) {
    throw new AiProviderError(
      "The rendition word is invalid.",
      "invalid_request",
      false,
    );
  }
  return word;
}

export function renditionPrompt(word: string): string {
  const subject = cleanWord(word);
  return [
    `Create a cinematic, believable real-world rendition of “${subject}” using the reference drawing as the composition authority.`,
    "Preserve every odd relative size, position, direction, silhouette, dominant stroke color, overlap, negative space, and awkward detail.",
    "Treat apparent mistakes as intentional.",
    "Do not add text, captions, borders, signatures, or improve the composition into generic tasteful artwork.",
  ].join(" ");
}

function decodeJpeg(encoded: unknown): Uint8Array {
  if (typeof encoded !== "string" || !encoded) {
    throw invalid("GPT Image 2 returned no image.");
  }

  const maxEncodedLength = Math.ceil((RENDITION_MAX_BYTES * 4) / 3) + 4;
  if (encoded.length > maxEncodedLength) {
    throw invalid("GPT Image 2 returned an oversized image.");
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw invalid("GPT Image 2 returned malformed image data.");
  }
  if (binary.length > RENDITION_MAX_BYTES) {
    throw invalid("GPT Image 2 returned an oversized image.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (
    bytes.length < 3 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    throw invalid("GPT Image 2 returned a non-JPEG image.");
  }
  return bytes;
}

function ambiguousProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const name =
    error instanceof DOMException
      ? error.name
      : object(error)?.name;
  if (name === "AbortError") {
    return new AiProviderError(
      "GPT Image 2 timed out after the upload began.",
      "timeout",
      false,
    );
  }
  return new AiProviderError(
    "The GPT Image 2 request ended ambiguously after upload.",
    "ambiguous_network_error",
    false,
  );
}

export async function requestRendition(
  input: RenditionInput,
  config: RenditionConfig,
): Promise<Uint8Array> {
  if (!config.apiKey) {
    throw new AiProviderError(
      "The AI provider is not configured.",
      "missing_api_key",
      false,
    );
  }

  const form = new FormData();
  form.set("model", "gpt-image-2");
  form.set("image", new Blob([input.png], { type: "image/png" }), "drawing.png");
  form.set("prompt", renditionPrompt(input.word));
  form.set("size", "1024x1024");
  form.set("quality", "medium");
  form.set("output_format", "jpeg");
  form.set("output_compression", "85");
  form.set("moderation", "auto");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await (config.fetchImpl ?? fetch)(IMAGE_EDITS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw await providerResponseError(response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalid("GPT Image 2 returned an unreadable response.");
    }
    const data = object(body)?.data;
    const first = Array.isArray(data) ? object(data[0]) : null;
    return decodeJpeg(first?.b64_json);
  } catch (error) {
    throw ambiguousProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}
