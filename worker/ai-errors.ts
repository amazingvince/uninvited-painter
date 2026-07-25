export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export async function providerResponseError(
  response: Response,
): Promise<AiProviderError> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = null;
  }

  const error = record(record(body)?.error);
  const providerCode =
    typeof error?.code === "string" && error.code.length <= 100
      ? error.code
      : `http_${response.status}`;
  const retryable = response.status === 429 || response.status >= 500;
  const requestId = response.headers.get("x-request-id") ?? undefined;

  return new AiProviderError(
    retryable
      ? "The AI provider is temporarily unavailable."
      : "The AI provider rejected the request.",
    providerCode,
    retryable,
    requestId,
  );
}

export function providerRequestError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (
    error instanceof DOMException
      ? error.name === "AbortError"
      : record(error)?.name === "AbortError"
  ) {
    return new AiProviderError("The AI provider timed out.", "timeout", true);
  }
  return new AiProviderError(
    "The AI provider could not be reached.",
    "network_error",
    true,
  );
}
