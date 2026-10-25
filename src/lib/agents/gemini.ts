const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const REQUEST_TIMEOUT_MS = 25_000;

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
};

export class GeminiAgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "GeminiAgentError";
  }
}

function safeModelName(value: string | undefined): string {
  if (!value) return DEFAULT_MODEL;
  return /^[a-z0-9._-]+$/i.test(value) ? value : DEFAULT_MODEL;
}

export function getGeminiModel(): string {
  return safeModelName(process.env.GEMINI_MODEL);
}

function sanitizeProviderMessage(value: unknown): string {
  if (typeof value !== "string") return "No provider message was supplied.";
  return value
    .replace(/x-goog-api-key\s*:\s*[^\s,;]+/gi, "x-goog-api-key: [REDACTED]")
    .replace(/AIza[a-z0-9_-]+/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[URL REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

async function providerError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown; status?: unknown } };
    const message = sanitizeProviderMessage(payload.error?.message);
    const type =
      typeof payload.error?.status === "string"
        ? payload.error.status.replace(/[^A-Z0-9_]/gi, "_").slice(0, 60)
        : "UNKNOWN";
    return `${type}: ${message}`;
  } catch {
    return "UNKNOWN: Gemini returned an unreadable error response.";
  }
}

export async function generateStructuredJson<T>({
  apiKey,
  systemInstruction,
  prompt,
  schema,
  validate,
}: {
  apiKey: string;
  systemInstruction: string;
  prompt: string;
  schema: Record<string, unknown>;
  validate: (value: unknown) => T;
}): Promise<T> {
  const model = getGeminiModel();
  let response: Response;

  try {
    response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.2,
          maxOutputTokens: 3_000,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new GeminiAgentError(
      timedOut
        ? "The buyer analysis service took too long to respond."
        : "Could not reach the buyer analysis service.",
      timedOut ? "GEMINI_TIMEOUT" : "GEMINI_NETWORK_ERROR",
      504,
    );
  }

  if (!response.ok) {
    const detail = await providerError(response);
    if (process.env.NODE_ENV === "development") {
      console.error("VETO Gemini upstream error", { status: response.status, detail });
    }
    throw new GeminiAgentError(
      process.env.NODE_ENV === "development"
        ? `Gemini rejected the analysis request (${response.status}): ${detail}`
        : "The buyer analysis service rejected the request.",
      `GEMINI_UPSTREAM_${response.status}`,
      response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 503 : 502,
    );
  }

  let payload: GeminiResponse;
  try {
    payload = (await response.json()) as GeminiResponse;
  } catch {
    throw new GeminiAgentError(
      "The buyer analysis service returned an unreadable response.",
      "GEMINI_INVALID_RESPONSE",
    );
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    const blockReason = payload.promptFeedback?.blockReason;
    throw new GeminiAgentError(
      blockReason
        ? `The buyer analysis request was blocked (${blockReason}).`
        : "The buyer analysis service returned no structured output.",
      blockReason ? "GEMINI_BLOCKED" : "GEMINI_EMPTY_RESPONSE",
      422,
    );
  }

  try {
    return validate(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof GeminiAgentError) throw error;
    throw new GeminiAgentError(
      "The buyer analysis service returned data that failed validation.",
      "GEMINI_SCHEMA_VALIDATION_FAILED",
    );
  }
}
