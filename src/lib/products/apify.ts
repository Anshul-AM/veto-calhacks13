import { normalizeProducts } from "./normalize";
import type { ProductCandidate } from "./types";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const ACTOR_ID = "damilo~google-shopping-apify";
const POLL_INTERVAL_MS = 1_500;
const RUN_TIMEOUT_MS = 75_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 30;

type RunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMING-OUT"
  | "TIMED-OUT";

type ActorRun = {
  id: string;
  status: RunStatus;
  defaultDatasetId?: string;
  startedAt?: string;
  finishedAt?: string;
};

type GoogleShoppingActorInput = {
  query: string;
  country: "us";
  language: "en";
  num: "10";
  max_pages: 1;
};

type SearchResult = {
  products: ProductCandidate[];
  actorRunId: string;
  sourceTimestamp: string;
};

type CachedRun = {
  rawItems: unknown[];
  actorRunId: string;
  sourceTimestamp: string;
};

type CacheEntry = {
  expiresAt: number;
  result: CachedRun;
};

type ApifyErrorDetails = {
  status: number;
  type: string;
  message: string;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<CachedRun>>();

export class ProductProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 502,
    public readonly upstreamStatus?: number,
    public readonly upstreamType?: string,
  ) {
    super(message);
    this.name = "ProductProviderError";
  }
}

function sanitizeDiagnosticMessage(value: unknown): string {
  if (typeof value !== "string") return "No upstream error message was provided.";

  const sanitized = value
    .replace(/authorization\s*:\s*[^\s,;]+/gi, "authorization: [REDACTED]")
    .replace(/cookie\s*:\s*[^\r\n]+/gi, "cookie: [REDACTED]")
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/apify_api_[a-z0-9_-]+/gi, "[REDACTED]")
    .replace(/([?&](?:token|api[_-]?key|key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[URL REDACTED]")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[EMAIL REDACTED]")
    .replace(/\b[a-z0-9_-]{32,}\b/gi, "[IDENTIFIER REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return sanitized.slice(0, 500) || "No upstream error message was provided.";
}

function sanitizeErrorType(value: unknown): string {
  if (typeof value !== "string") return "unknown-error";
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
  return sanitized || "unknown-error";
}

async function readApifyError(response: Response): Promise<ApifyErrorDetails> {
  let type = "unknown-error";
  let message = response.statusText || "Apify rejected the request.";

  try {
    const rawBody = await response.text();
    if (rawBody) {
      try {
        const payload = JSON.parse(rawBody) as unknown;
        if (typeof payload === "object" && payload !== null && "error" in payload) {
          const error = (payload as { error?: unknown }).error;
          if (typeof error === "object" && error !== null) {
            const upstreamError = error as { type?: unknown; message?: unknown };
            type = sanitizeErrorType(upstreamError.type);
            message = sanitizeDiagnosticMessage(upstreamError.message);
          } else {
            message = sanitizeDiagnosticMessage(error);
          }
        } else {
          message = sanitizeDiagnosticMessage(rawBody);
        }
      } catch {
        message = sanitizeDiagnosticMessage(rawBody);
      }
    }
  } catch {
    message = sanitizeDiagnosticMessage(message);
  }

  return { status: response.status, type, message };
}

async function apifyFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (init?.body !== undefined && init.body !== null) {
      headers.set("Content-Type", "application/json");
    }

    response = await fetch(`${APIFY_BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new ProductProviderError(
      timedOut ? "The product provider took too long to respond." : "Could not reach the product provider.",
      timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_ERROR",
      504,
    );
  }

  if (!response.ok) {
    const upstreamError = await readApifyError(response);
    if (process.env.NODE_ENV === "development") {
      console.error("VETO Apify upstream error", {
        status: upstreamError.status,
        type: upstreamError.type,
        message: upstreamError.message,
      });
    }

    const codeType = upstreamError.type.replace(/-/g, "_").toUpperCase();
    const developmentMessage = `Apify rejected the request (upstream ${upstreamError.status}; ${upstreamError.type}): ${upstreamError.message}`;
    const productionMessage = `The product provider rejected the request (upstream ${upstreamError.status}; ${upstreamError.type}).`;
    throw new ProductProviderError(
      process.env.NODE_ENV === "development" ? developmentMessage : productionMessage,
      `APIFY_UPSTREAM_${upstreamError.status}_${codeType}`,
      upstreamError.status === 401 || upstreamError.status === 403 ? 503 : 502,
      upstreamError.status,
      upstreamError.type,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ProductProviderError(
      "The product provider returned an unreadable response.",
      "PROVIDER_INVALID_RESPONSE",
    );
  }
}

function unwrapData<T>(payload: unknown): T {
  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as { data: T }).data;
  }
  throw new ProductProviderError(
    "The product provider returned a success response without the expected data wrapper.",
    "PROVIDER_MISSING_DATA_WRAPPER",
  );
}

function extractDatasetItems(payload: unknown): unknown[] {
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null && "items" in data) {
    const items = (data as { items: unknown }).items;
    return Array.isArray(items) ? items : [];
  }
  return [];
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function pollRun(runId: string, token: string): Promise<ActorRun> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await apifyFetch<{ data: ActorRun }>(`/actor-runs/${runId}`, token);
    const run = unwrapData<ActorRun>(response);

    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      throw new ProductProviderError(
        `The product search ended with status ${run.status}. Please try again.`,
        `ACTOR_${run.status}`,
      );
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new ProductProviderError(
    "The product search is still taking too long. Please try again in a moment.",
    "ACTOR_POLL_TIMEOUT",
    504,
  );
}

async function launchAndCollect(query: string, token: string): Promise<CachedRun> {
  const actorInput: GoogleShoppingActorInput = {
    query,
    country: "us",
    language: "en",
    num: "10",
    max_pages: 1,
  };

  const launchResponse = await apifyFetch<{ data: ActorRun }>(`/actors/${ACTOR_ID}/runs`, token, {
    method: "POST",
    body: JSON.stringify(actorInput),
  });
  const launchedRun = unwrapData<ActorRun>(launchResponse);

  if (!launchedRun?.id) {
    throw new ProductProviderError(
      "The product provider did not return a run identifier.",
      "MISSING_RUN_ID",
    );
  }

  const run = await pollRun(launchedRun.id, token);
  if (!run.defaultDatasetId) {
    throw new ProductProviderError(
      "The completed product search did not include a dataset.",
      "MISSING_DATASET_ID",
    );
  }

  const datasetResponse = await apifyFetch<unknown>(
    `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=12`,
    token,
  );

  return {
    rawItems: extractDatasetItems(datasetResponse).slice(0, 12),
    actorRunId: run.id,
    sourceTimestamp: run.finishedAt ?? run.startedAt ?? new Date().toISOString(),
  };
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

export async function findProductCandidates(
  query: string,
  hardBudget: number | null,
  token: string,
): Promise<SearchResult & { cached: boolean }> {
  const key = query.trim().toLocaleLowerCase("en-US");
  pruneCache();

  const cachedEntry = cache.get(key);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return {
      ...cachedEntry.result,
      products: normalizeProducts(
        cachedEntry.result.rawItems,
        cachedEntry.result.sourceTimestamp,
        hardBudget,
      ),
      cached: true,
    };
  }

  let searchPromise = inFlight.get(key);
  if (!searchPromise) {
    searchPromise = launchAndCollect(query, token);
    inFlight.set(key, searchPromise);
  }

  try {
    const result = await searchPromise;
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return {
      ...result,
      products: normalizeProducts(result.rawItems, result.sourceTimestamp, hardBudget),
      cached: false,
    };
  } finally {
    if (inFlight.get(key) === searchPromise) inFlight.delete(key);
  }
}
