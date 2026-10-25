import type { CategoryFramework } from "@/lib/agents/types";
import type {
  EvidenceSourceType,
  InvestigationDiagnostics,
  RetrievalIssue,
  SearchResultContext,
  ShortlistedCandidate,
} from "./types";
import { domainForUrl, inspectPublicUrl, safePublicUrl } from "./url-safety";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const GOOGLE_SEARCH_ACTOR = "apify~google-search-scraper";
const RAG_WEB_BROWSER_ACTOR = "apify~rag-web-browser";
const REQUEST_TIMEOUT_MS = 20_000;
const RUN_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_500;
const MAX_QUERIES = 4;
const MAX_SOURCES_PER_MODEL = 2;

// Payload fields are intentionally limited to the published Actor schemas:
// https://apify.com/apify/google-search-scraper/input-schema
// https://apify.com/apify/rag-web-browser/input-schema

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
};

type OrganicResult = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  snippet?: unknown;
};

type SearchDatasetItem = {
  searchQuery?: { term?: unknown };
  query?: unknown;
  organicResults?: unknown;
  errorCode?: unknown;
};

export type SelectedSource = {
  candidateId: string;
  exactModel: string;
  query: string;
  title: string;
  url: string;
  domain: string;
  sourceType: EvidenceSourceType;
  searchSnippet: string;
};

export type SourcePlan = {
  candidateId: string;
  exactModel: string;
  primary: SelectedSource;
  fallback: SelectedSource | null;
};

export type CrawledSource = SelectedSource & {
  finalUrl: string;
  pageTitle: string;
  markdown: string;
  text: string;
  retrievalTimestamp: string;
};

export type RetrievalResult = {
  outcome: "completed" | "no_evidence" | "failed";
  sources: CrawledSource[];
  searchContexts: SearchResultContext[];
  issues: RetrievalIssue[];
  googleSearchRunId: string | null;
  websiteCrawlerRunId: string | null;
  ragWebBrowserRunIds: string[];
  retrievalTimestamp: string;
  diagnostics: InvestigationDiagnostics;
};

export type ActorResult = {
  runId: string;
  finalStatus: "SUCCEEDED";
  items: unknown[];
};

export class EvidenceProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 502,
    public runId: string | null = null,
    public actorStatus: RunStatus | null = null,
  ) {
    super(message);
    this.name = "EvidenceProviderError";
  }
}

function sanitizeProviderMessage(value: unknown): string {
  if (typeof value !== "string") return "No provider message was supplied.";
  return value
    .replace(/authorization\s*:\s*[^\s,;]+/gi, "authorization: [REDACTED]")
    .replace(/cookie\s*:\s*[^\r\n]+/gi, "cookie: [REDACTED]")
    .replace(/bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/apify_api_[a-z0-9_-]+/gi, "[REDACTED]")
    .replace(/([?&](?:token|api[_-]?key|key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[URL REDACTED]")
    .replace(/\b[a-z0-9_-]{32,}\b/gi, "[IDENTIFIER REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

async function providerError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { type?: unknown; message?: unknown } | unknown;
    };
    const error = payload.error;
    if (typeof error === "object" && error !== null) {
      const detail = error as { type?: unknown; message?: unknown };
      const type =
        typeof detail.type === "string"
          ? detail.type.replace(/[^a-z0-9_-]/gi, "-").slice(0, 60)
          : "unknown-error";
      return `${type}: ${sanitizeProviderMessage(detail.message)}`;
    }
    return sanitizeProviderMessage(error);
  } catch {
    return "unknown-error: Apify returned an unreadable error response.";
  }
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
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new EvidenceProviderError(
      timedOut ? "The evidence provider request timed out." : "Could not reach the evidence provider.",
      timedOut ? "EVIDENCE_PROVIDER_TIMEOUT" : "EVIDENCE_PROVIDER_NETWORK_ERROR",
      504,
    );
  }

  if (!response.ok) {
    const detail = await providerError(response);
    if (process.env.NODE_ENV === "development") {
      console.error("VETO evidence provider error", { status: response.status, detail });
    }
    throw new EvidenceProviderError(
      process.env.NODE_ENV === "development"
        ? `Apify rejected evidence retrieval (${response.status}): ${detail}`
        : `The evidence provider rejected the request (${response.status}).`,
      `EVIDENCE_APIFY_${response.status}`,
      response.status === 401 || response.status === 403 ? 503 : 502,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new EvidenceProviderError(
      "The evidence provider returned an unreadable response.",
      "EVIDENCE_PROVIDER_INVALID_RESPONSE",
    );
  }
}

function unwrapData<T>(payload: unknown): T {
  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as { data: T }).data;
  }
  throw new EvidenceProviderError(
    "The evidence provider response omitted its data wrapper.",
    "EVIDENCE_PROVIDER_MISSING_DATA",
  );
}

function datasetItems(payload: unknown): unknown[] {
  const data =
    typeof payload === "object" && payload !== null && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null && "items" in data) {
    const items = (data as { items?: unknown }).items;
    return Array.isArray(items) ? items : [];
  }
  return [];
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function pollRun(runId: string, token: string): Promise<ActorRun> {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  let lastStatus: RunStatus | null = null;
  while (Date.now() < deadline) {
    const payload = await apifyFetch<unknown>(`/actor-runs/${encodeURIComponent(runId)}`, token);
    const run = unwrapData<ActorRun>(payload);
    lastStatus = run.status;
    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      throw new EvidenceProviderError(
        `Evidence retrieval ended with status ${run.status}.`,
        `EVIDENCE_ACTOR_${run.status}`,
        502,
        runId,
        run.status,
      );
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new EvidenceProviderError(
    "Evidence retrieval exceeded the bounded wait time.",
    "EVIDENCE_ACTOR_POLL_TIMEOUT",
    504,
    runId,
    lastStatus,
  );
}

async function runActor(actorId: string, input: object, token: string): Promise<ActorResult> {
  const launchPayload = await apifyFetch<unknown>(`/actors/${actorId}/runs`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const launched = unwrapData<ActorRun>(launchPayload);
  if (!launched.id) {
    throw new EvidenceProviderError(
      "The evidence provider did not return a run identifier.",
      "EVIDENCE_MISSING_RUN_ID",
    );
  }
  let run: ActorRun;
  try {
    run = await pollRun(launched.id, token);
  } catch (error) {
    if (error instanceof EvidenceProviderError && !error.runId) error.runId = launched.id;
    throw error;
  }
  if (!run.defaultDatasetId) {
    throw new EvidenceProviderError(
      "The completed evidence run did not include a dataset.",
      "EVIDENCE_MISSING_DATASET_ID",
      502,
      run.id,
      run.status,
    );
  }
  let payload: unknown;
  try {
    payload = await apifyFetch<unknown>(
      `/datasets/${encodeURIComponent(run.defaultDatasetId)}/items?clean=true&limit=20`,
      token,
    );
  } catch (error) {
    if (error instanceof EvidenceProviderError) {
      error.runId = run.id;
      error.actorStatus = run.status;
    }
    throw error;
  }
  return { runId: run.id, finalStatus: "SUCCEEDED", items: datasetItems(payload) };
}

function emptyDiagnostics(): InvestigationDiagnostics {
  return {
    search: {
      launched: false,
      finalStatus: null,
      datasetItemCount: 0,
      errorRowCount: 0,
      organicResultCount: 0,
      candidateUrlCount: 0,
      selectedSourceCount: 0,
      rejectedUrlCounts: {},
    },
    crawl: {
      launched: false,
      finalStatus: null,
      datasetItemCount: 0,
      pagesWithContent: 0,
      parsedPageCount: 0,
      rejectedPageCounts: {},
    },
    evidence: {
      candidatePassageCount: 0,
      relevantPassageCount: 0,
      retainedPassageCount: 0,
    },
  };
}

function increment(counts: Record<string, number>, reason: string) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

function boundedModelName(value: string): string {
  return value.replace(/[^a-z0-9&+.' -]/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 12).join(" ");
}

function researchQueries(
  shortlist: ShortlistedCandidate[],
  framework: CategoryFramework,
): Array<{ candidate: ShortlistedCandidate; query: string; kind: "official" | "review" }> {
  const criteria = framework.evaluationCriteria
    .filter((criterion) => criterion.priority !== "contextual")
    .slice(0, 2)
    .map((criterion) => boundedModelName(criterion.name).split(" ").slice(0, 3).join(" "))
    .join(" ") || "real world review";
  const byCandidate = shortlist.map((candidate) => {
    const model = boundedModelName(candidate.exactModel);
    return {
      official: { candidate, query: `"${model}" official specifications`, kind: "official" as const },
      review: { candidate, query: `"${model}" independent review ${criteria}`, kind: "review" as const },
    };
  });
  return [
    ...byCandidate.map((entry) => entry.official),
    ...byCandidate.map((entry) => entry.review),
  ].slice(0, MAX_QUERIES);
}

const RETAILER_DOMAINS = [
  "amazon.", "walmart.", "target.", "ebay.", "zappos.", "dickssportinggoods.",
  "rei.com", "runningwarehouse.com", "fleetfeet.com", "roadrunnersports.com",
];

const BLOCKED_RESELLER_DOMAINS = [
  "desertcart.", "ubuy.", "aliexpress.", "temu.", "shopstyle.", "shopping.yahoo.",
];

const REPUTABLE_REVIEW_DOMAINS = [
  "believeintherun.com", "doctorsofrunning.com", "gearjunkie.com", "outdoorgearlab.com",
  "roadtrailrun.com", "runrepeat.com", "runnersworld.com", "solereview.com",
];

const MANUFACTURER_DOMAINS = new Set([
  "adidas.com", "altrarunning.com", "asics.com", "brooksrunning.com", "hoka.com",
  "mizunousa.com", "newbalance.com", "nike.com", "on.com", "puma.com", "reebok.com",
  "saucony.com", "skechers.com", "topoathletic.com", "underarmour.com",
]);

function isKnownManufacturerDomain(domain: string): boolean {
  return [...MANUFACTURER_DOMAINS].some(
    (official) => domain === official || domain.endsWith(`.${official}`),
  );
}

function classifySource(domain: string): EvidenceSourceType {
  const lower = domain.toLowerCase();
  if (lower === "reddit.com" || lower.endsWith(".reddit.com")) return "community";
  if (RETAILER_DOMAINS.some((item) => lower.includes(item.toLowerCase()))) return "retailer";
  if (isKnownManufacturerDomain(lower)) return "manufacturer";
  return "independent";
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function cleanPageContent(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 24_000);
}

const MODEL_GENERIC_WORDS = new Set([
  "adult", "black", "blue", "color", "colour", "gray", "grey", "men", "mens", "navy",
  "red", "road", "running", "shoe", "shoes", "size", "sneaker", "sneakers", "unisex",
  "walking", "white", "wide", "women", "womens",
]);

function modelIdentityTerms(model: string): string[] {
  return model
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !MODEL_GENERIC_WORDS.has(word))
    .filter((word, index, all) => all.indexOf(word) === index)
    .slice(0, 8);
}

function refersToExactModel(result: OrganicResult, exactModel: string): boolean {
  const title = cleanText(result.title, 400);
  const url = safePublicUrl(result.url);
  let pathname = "";
  if (url) {
    try {
      pathname = decodeURIComponent(new URL(url).pathname);
    } catch {
      pathname = new URL(url).pathname;
    }
  }
  const haystack = `${title} ${pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const compact = haystack.replace(/\s+/g, "");
  const identity = modelIdentityTerms(exactModel);
  if (identity.length === 0) return false;
  const required = identity.slice(0, Math.min(3, identity.length));
  const versionTerms = identity.filter((term) => /\d/.test(term));
  return [...new Set([...required, ...versionTerms])].every(
    (term) => haystack.split(/\s+/).includes(term) || compact.includes(term),
  );
}

function isBlockedReseller(domain: string): boolean {
  const lower = domain.toLowerCase();
  return BLOCKED_RESELLER_DOMAINS.some((item) => lower.includes(item));
}

function looksLikeIndependentReview(result: OrganicResult, domain: string): boolean {
  if (REPUTABLE_REVIEW_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) {
    return true;
  }
  const context = `${cleanText(result.title, 300)} ${safePublicUrl(result.url) ?? ""}`;
  return /\b(review|reviewed|test|tested|wear test|road test|first look)\b/i.test(context);
}

function sourceScore(
  sourceType: EvidenceSourceType,
  queryKind: "official" | "review",
  result: OrganicResult,
  domain: string,
  resultIndex: number,
): number {
  let score = Math.max(0, 20 - resultIndex);
  if (sourceType === "manufacturer") score += 100;
  if (sourceType === "independent" && looksLikeIndependentReview(result, domain)) score += 80;
  if (queryKind === "review" && sourceType === "independent") score += 20;
  if (queryKind === "official" && sourceType === "manufacturer") score += 20;
  return score;
}

export function selectSourcePlans(
  items: unknown[],
  queries: ReturnType<typeof researchQueries>,
  diagnostics: InvestigationDiagnostics["search"],
): SourcePlan[] {
  const rows = items
    .filter((item): item is SearchDatasetItem => typeof item === "object" && item !== null)
    .map((row) => ({
      term: cleanText(row.searchQuery?.term ?? row.query, 500),
      errorCode:
        typeof row.errorCode === "string"
          ? row.errorCode.replace(/[^A-Z0-9_-]/gi, "_").slice(0, 60).toUpperCase()
          : null,
      results: Array.isArray(row.organicResults)
        ? row.organicResults.filter(
            (entry): entry is OrganicResult => typeof entry === "object" && entry !== null,
          )
        : [],
    }));

  diagnostics.errorRowCount = rows.filter((row) => row.errorCode !== null).length;
  for (const row of rows) {
    if (row.errorCode) increment(diagnostics.rejectedUrlCounts, `search_row_${row.errorCode}`);
  }
  diagnostics.organicResultCount = rows.reduce((total, row) => total + row.results.length, 0);
  diagnostics.candidateUrlCount = rows.reduce(
    (total, row) => total + row.results.filter((result) => typeof result.url === "string").length,
    0,
  );

  const candidates = new Map<string, Array<{ source: SelectedSource; score: number }>>();
  for (const [queryIndex, query] of queries.entries()) {
    const normalizedQuery = query.query.replace(/\s+/g, " ").trim().toLowerCase();
    const exactRow = rows.find(
      (row) => row.term.replace(/\s+/g, " ").trim().toLowerCase() === normalizedQuery,
    );
    const pool = exactRow?.results.length ? exactRow.results : (rows[queryIndex]?.results ?? []);
    for (const [resultIndex, result] of pool.entries()) {
      const inspected = inspectPublicUrl(result.url);
      if (inspected.reason !== null) {
        increment(diagnostics.rejectedUrlCounts, inspected.reason);
        continue;
      }
      const url = inspected.url;
      const domain = domainForUrl(url);
      if (domain.includes("google.") || domain === "google.com") {
        increment(diagnostics.rejectedUrlCounts, "google_result_url");
        continue;
      }
      if (isBlockedReseller(domain)) {
        increment(diagnostics.rejectedUrlCounts, "reseller_mirror");
        continue;
      }
      if (!refersToExactModel(result, query.candidate.exactModel)) {
        increment(diagnostics.rejectedUrlCounts, "model_mismatch");
        continue;
      }
      const sourceType = classifySource(domain);
      if (sourceType === "community") {
        increment(diagnostics.rejectedUrlCounts, "community_deferred");
        continue;
      }
      if (query.kind === "review" && sourceType === "manufacturer") {
        increment(diagnostics.rejectedUrlCounts, "manufacturer_in_review_slot");
        continue;
      }
      if (query.kind === "review" && sourceType === "retailer") {
        increment(diagnostics.rejectedUrlCounts, "retailer_not_independent_review");
        continue;
      }
      if (
        sourceType === "independent" &&
        !looksLikeIndependentReview(result, domain) &&
        /\b(shop|shopping|buy|price|coupon|deal|sale)\b/i.test(`${cleanText(result.title, 300)} ${url}`)
      ) {
        increment(diagnostics.rejectedUrlCounts, "generic_shopping_listing");
        continue;
      }
      const source: SelectedSource = {
        candidateId: query.candidate.candidateId,
        exactModel: query.candidate.exactModel,
        query: query.query,
        title: cleanText(result.title, 240) || domain,
        url,
        domain,
        sourceType,
        searchSnippet: cleanText(result.description ?? result.snippet, 500),
      };
      const list = candidates.get(source.candidateId) ?? [];
      const existing = list.find((entry) => entry.source.url === url);
      const score = sourceScore(sourceType, query.kind, result, domain, resultIndex);
      if (!existing) list.push({ source, score });
      else if (score > existing.score) {
        existing.source = source;
        existing.score = score;
      }
      candidates.set(source.candidateId, list);
    }
  }

  const plans: SourcePlan[] = [];
  for (const query of queries) {
    if (plans.some((plan) => plan.candidateId === query.candidate.candidateId)) continue;
    const ranked = (candidates.get(query.candidate.candidateId) ?? [])
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.source);
    if (ranked.length === 0) continue;
    const primary = ranked[0];
    const differentDomain = ranked.find((source) => source.domain !== primary.domain);
    const fallback = differentDomain ?? ranked[1] ?? null;
    plans.push({
      candidateId: query.candidate.candidateId,
      exactModel: query.candidate.exactModel,
      primary,
      fallback,
    });
  }
  diagnostics.selectedSourceCount = plans.reduce(
    (total, plan) => total + Math.min(MAX_SOURCES_PER_MODEL, plan.fallback ? 2 : 1),
    0,
  );
  return plans;
}

function readNestedString(value: unknown, path: string[]): string {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
}

function readNestedNumber(value: unknown, path: string[]): number | null {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

export function normalizeRagResult(
  items: unknown[],
  source: SelectedSource,
  diagnostics: InvestigationDiagnostics["crawl"],
): CrawledSource | null {
  if (items.length === 0) increment(diagnostics.rejectedPageCounts, "empty_rag_dataset");
  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      increment(diagnostics.rejectedPageCounts, "invalid_dataset_item");
      continue;
    }
    const row = item as Record<string, unknown>;
    const httpStatus = readNestedNumber(row, ["crawl", "httpStatusCode"]);
    if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 400)) {
      increment(diagnostics.rejectedPageCounts, `http_status_${Math.trunc(httpStatus)}`);
      continue;
    }
    const requestStatus = readNestedString(row, ["crawl", "requestStatus"]);
    if (requestStatus && requestStatus.toLowerCase() !== "handled") {
      increment(
        diagnostics.rejectedPageCounts,
        `request_status_${requestStatus.replace(/[^a-z0-9_-]/gi, "_").toLowerCase().slice(0, 40)}`,
      );
      continue;
    }
    const hasPageError =
      (row.errorMessage !== undefined && row.errorMessage !== null) ||
      (row.error !== undefined && row.error !== null) ||
      Boolean(readNestedString(row, ["crawl", "errorMessage"]));
    if (hasPageError) {
      increment(diagnostics.rejectedPageCounts, "page_error_record");
      continue;
    }
    const finalInspection = inspectPublicUrl(
      readNestedString(row, ["crawl", "loadedUrl"]) ||
        readNestedString(row, ["metadata", "redirectedUrl"]) ||
        readNestedString(row, ["metadata", "url"]) ||
        row.url ||
        source.url,
    );
    if (!finalInspection.url) {
      increment(diagnostics.rejectedPageCounts, `unsafe_final_url_${finalInspection.reason}`);
      continue;
    }
    const finalUrl = finalInspection.url;
    const finalDomain = domainForUrl(finalUrl);
    const sameDomainFamily =
      source.domain === finalDomain ||
      finalDomain.endsWith(`.${source.domain}`) ||
      source.domain.endsWith(`.${finalDomain}`);
    if (!sameDomainFamily) {
      increment(diagnostics.rejectedPageCounts, "cross_domain_redirect");
      continue;
    }
    const markdown = cleanPageContent(row.markdown);
    const text = cleanPageContent(row.text);
    if (!markdown && !text) {
      increment(diagnostics.rejectedPageCounts, "empty_markdown_and_text");
      continue;
    }
    diagnostics.pagesWithContent += 1;
    diagnostics.parsedPageCount += 1;
    return {
      ...source,
      finalUrl,
      domain: finalDomain,
      pageTitle: cleanText(row.title ?? readNestedString(row, ["metadata", "title"]), 240) || source.title,
      markdown,
      text,
      retrievalTimestamp:
        cleanText(
          readNestedString(row, ["crawl", "loadedTime"]) ||
            readNestedString(row, ["crawl", "loadedAt"]) ||
            row.fetchedAt,
          80,
        ) || new Date().toISOString(),
    };
  }
  return null;
}

export async function fetchSourcePlan(
  plan: SourcePlan,
  fetchPage: (source: SelectedSource, attempt: 0 | 1) => Promise<ActorResult>,
  diagnostics: InvestigationDiagnostics["crawl"],
): Promise<{
  source: CrawledSource | null;
  runIds: string[];
  actorFailures: number;
  pageFailures: number;
}> {
  const runIds: string[] = [];
  let actorFailures = 0;
  let pageFailures = 0;
  const attempts = [plan.primary, plan.fallback].filter(
    (source): source is SelectedSource => source !== null,
  ).slice(0, MAX_SOURCES_PER_MODEL);

  for (const [index, source] of attempts.entries()) {
    try {
      const run = await fetchPage(source, index as 0 | 1);
      runIds.push(run.runId);
      diagnostics.datasetItemCount += run.items.length;
      const parsed = normalizeRagResult(run.items, source, diagnostics);
      if (parsed) return { source: parsed, runIds, actorFailures, pageFailures };
      pageFailures += 1;
    } catch (error) {
      actorFailures += 1;
      if (error instanceof EvidenceProviderError && error.runId) runIds.push(error.runId);
      increment(
        diagnostics.rejectedPageCounts,
        error instanceof EvidenceProviderError ? error.code.toLowerCase() : "rag_fetch_failed",
      );
    }
  }

  return { source: null, runIds, actorFailures, pageFailures };
}

export async function retrieveEvidenceSources(
  shortlist: ShortlistedCandidate[],
  framework: CategoryFramework,
  token: string,
): Promise<RetrievalResult> {
  const issues: RetrievalIssue[] = [];
  const diagnostics = emptyDiagnostics();
  const queries = researchQueries(shortlist, framework);
  let googleSearchRunId: string | null = null;
  const websiteCrawlerRunId: string | null = null;
  const ragWebBrowserRunIds: string[] = [];
  let searchItems: unknown[] = [];
  let searchContexts: SearchResultContext[] = [];

  const finish = (
    outcome: RetrievalResult["outcome"],
    sources: CrawledSource[] = [],
  ): RetrievalResult => {
    const result: RetrievalResult = {
      outcome,
      sources,
      searchContexts,
      issues,
      googleSearchRunId,
      websiteCrawlerRunId,
      ragWebBrowserRunIds,
      retrievalTimestamp: new Date().toISOString(),
      diagnostics,
    };
    if (process.env.NODE_ENV === "development") {
      console.info("VETO evidence retrieval diagnostics", {
        outcome,
        searchRun: googleSearchRunId?.slice(0, 8) ?? null,
        ragRuns: ragWebBrowserRunIds.map((runId) => runId.slice(0, 8)),
        search: diagnostics.search,
        crawl: diagnostics.crawl,
      });
    }
    return result;
  };

  try {
    const search = await runActor(
      GOOGLE_SEARCH_ACTOR,
      {
        queries: queries.map((entry) => entry.query).join("\n"),
        maxPagesPerQuery: 1,
        countryCode: "us",
        languageCode: "en",
        mobileResults: false,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
      },
      token,
    );
    googleSearchRunId = search.runId;
    searchItems = search.items;
    diagnostics.search.launched = true;
    diagnostics.search.finalStatus = search.finalStatus;
    diagnostics.search.datasetItemCount = search.items.length;
  } catch (error) {
    if (error instanceof EvidenceProviderError) {
      googleSearchRunId = error.runId;
      diagnostics.search.launched = Boolean(error.runId);
      diagnostics.search.finalStatus = error.actorStatus;
    }
    issues.push({
      stage: "search",
      code: error instanceof EvidenceProviderError ? error.code : "SEARCH_FAILED",
      message: error instanceof Error ? error.message : "Source discovery failed.",
    });
    return finish("failed");
  }

  const plans = selectSourcePlans(searchItems, queries, diagnostics.search);
  const selected = plans.flatMap((plan) => [plan.primary, ...(plan.fallback ? [plan.fallback] : [])]);
  searchContexts = selected.map((source) => ({
    candidateId: source.candidateId,
    exactModel: source.exactModel,
    title: source.title,
    url: source.url,
    domain: source.domain,
    sourceType: source.sourceType,
    snippet: source.searchSnippet || null,
  }));
  if (selected.length === 0) {
    issues.push({
      stage: "search",
      code:
        diagnostics.search.errorRowCount > 0
          ? "SEARCH_RESULT_ROWS_FAILED"
          : diagnostics.search.organicResultCount === 0
            ? "NO_SEARCH_RESULTS"
            : "NO_VALID_SOURCE_URLS",
      message:
        diagnostics.search.errorRowCount > 0
          ? "Google Search finished, but one or more dataset rows reported a sanitized search error category and no source could be selected."
          : diagnostics.search.organicResultCount === 0
          ? "Google Search completed but returned no organic result rows for the model queries."
          : "Google Search returned results, but none produced an eligible public source URL after safety and source-selection checks.",
    });
    return finish(diagnostics.search.errorRowCount > 0 ? "failed" : "no_evidence");
  }

  if (diagnostics.search.errorRowCount > 0) {
    issues.push({
      stage: "search",
      code: "PARTIAL_SEARCH_RESULTS",
      message: `${diagnostics.search.errorRowCount} search dataset row${diagnostics.search.errorRowCount === 1 ? "" : "s"} reported an error category; retrieval continued with the valid rows.`,
    });
  }

  const fetches = await Promise.all(
    plans.map((plan) => fetchSourcePlan(
      plan,
      (source) => runActor(
        RAG_WEB_BROWSER_ACTOR,
        {
          query: source.url,
          maxResults: 1,
          outputFormats: ["markdown"],
          requestTimeoutSecs: 30,
          scrapingTool: "raw-http",
          maxRequestRetries: 0,
          removeCookieWarnings: false,
          debugMode: false,
        },
        token,
      ),
      diagnostics.crawl,
    )),
  );

  diagnostics.crawl.launched = fetches.length > 0;
  const sources = fetches.flatMap((result) => result.source ? [result.source] : []);
  const failedRuns = fetches.reduce((total, result) => total + result.actorFailures, 0);
  const failedPages = fetches.reduce((total, result) => total + result.pageFailures, 0);
  ragWebBrowserRunIds.push(...fetches.flatMap((result) => result.runIds));

  diagnostics.crawl.finalStatus = sources.length === plans.length
    ? failedRuns + failedPages > 0 ? "SUCCEEDED_AFTER_FALLBACK" : "SUCCEEDED"
    : sources.length > 0
      ? "PARTIAL"
      : failedPages > 0
        ? "PAGE_FETCH_FAILED"
        : "FAILED";
  if (failedRuns > 0) {
    issues.push({
      stage: "crawl",
      code: sources.length > 0 ? "PARTIAL_RAG_FETCH" : "RAG_FETCH_FAILED",
      message: `${failedRuns} bounded RAG Web Browser Actor run${failedRuns === 1 ? "" : "s"} failed or timed out.`,
    });
  }
  if (failedPages > 0) {
    issues.push({
      stage: "crawl",
      code: sources.length > 0 ? "PAGE_FETCH_FALLBACK_USED" : "PAGE_FETCH_FAILED",
      message: sources.length > 0
        ? `${failedPages} target page fetch${failedPages === 1 ? "" : "es"} failed inside successful Actor runs; VETO continued with a bounded alternate source already found by Google Search.`
        : `${failedPages} target page fetch${failedPages === 1 ? "" : "es"} failed inside successful Actor runs, including the bounded alternate sources.`,
    });
  }
  if (sources.length === 0) {
    issues.push({
      stage: "crawl",
      code:
        diagnostics.crawl.datasetItemCount === 0
          ? "EMPTY_RAG_DATASETS"
          : "NO_USABLE_RAG_PAGES",
      message:
        diagnostics.crawl.datasetItemCount === 0
          ? "The bounded page fetches returned no dataset rows."
          : "Page fetches returned rows, but none contained safe same-domain Markdown for the exact selected source.",
    });
    return finish(failedRuns + failedPages > 0 ? "failed" : "no_evidence");
  }
  if (sources.length < plans.length) {
    issues.push({
      stage: "crawl",
      code: "PARTIAL_RAG_COVERAGE",
      message: `${sources.length} of ${plans.length} shortlisted models yielded usable same-domain Markdown.`,
    });
  }
  return finish("completed", sources);
}
