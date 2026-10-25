import { createHash } from "node:crypto";
import { GeminiAgentError } from "@/lib/agents/gemini";
import { analyzeEvidence } from "./evidence-analyst";
import { challengeCandidates } from "./challenger";
import { judgeCandidates } from "./final-judge";
import { retrieveEvidenceSources, type RetrievalResult } from "./apify-retrieval";
import { buildEvidenceRecords } from "./evidence";
import { shortlistProducts } from "./shortlist";
import { deriveEvidenceStatus } from "./status";
import type {
  EvidenceRecord,
  InvestigationDiagnostics,
  InvestigationEvidenceStatus,
  InvestigationRequest,
  InvestigationResponse,
  ShortlistedCandidate,
  FinalVerdict,
} from "./types";

const EVIDENCE_CACHE_TTL_MS = 30 * 60_000;
const NO_EVIDENCE_CACHE_TTL_MS = 5 * 60_000;
const FAILED_RETRIEVAL_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 20;

type RetrievalBundle = {
  retrieval: RetrievalResult;
  evidence: EvidenceRecord[];
};

type CachedRetrieval = RetrievalBundle & { expiresAt: number };
type CachedInvestigation = { expiresAt: number; response: InvestigationResponse };

const retrievalCache = new Map<string, CachedRetrieval>();
const retrievalInFlight = new Map<string, Promise<RetrievalBundle>>();
const investigationCache = new Map<string, CachedInvestigation>();
const investigationInFlight = new Map<string, Promise<InvestigationResponse>>();

function cacheKey(input: InvestigationRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      query: input.query.toLowerCase(),
      products: input.products.map((product) => [product.productId, product.title, product.price]),
      criteria: input.categoryFramework.evaluationCriteria.map((criterion) => criterion.name),
      claims: input.categoryFramework.claimsToVerify,
    }))
    .digest("hex");
}

function pruneCache<T extends { expiresAt: number }>(cache: Map<string, T>) {
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function cacheTtl(status: InvestigationEvidenceStatus): number {
  if (status === "RETRIEVAL_FAILED") return FAILED_RETRIEVAL_CACHE_TTL_MS;
  if (status === "NO_EVIDENCE") return NO_EVIDENCE_CACHE_TTL_MS;
  return EVIDENCE_CACHE_TTL_MS;
}

function retrievalCacheTtl(retrieval: RetrievalResult, evidence: EvidenceRecord[]): number {
  if (retrieval.outcome === "failed") return FAILED_RETRIEVAL_CACHE_TTL_MS;
  if (evidence.length === 0) return NO_EVIDENCE_CACHE_TTL_MS;
  return EVIDENCE_CACHE_TTL_MS;
}

async function getRetrieval(
  key: string,
  shortlist: ShortlistedCandidate[],
  input: InvestigationRequest,
  token: string,
): Promise<RetrievalBundle & { cacheHit: boolean }> {
  pruneCache(retrievalCache);
  const cached = retrievalCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { retrieval: cached.retrieval, evidence: cached.evidence, cacheHit: true };
  }

  let promise = retrievalInFlight.get(key);
  if (!promise) {
    promise = (async () => {
      const retrieval = await retrieveEvidenceSources(
        shortlist,
        input.categoryFramework,
        token,
      );
      const built = buildEvidenceRecords(retrieval.sources, input.categoryFramework);
      retrieval.diagnostics.evidence = built.diagnostics;
      if (built.records.length === 0 && retrieval.sources.length > 0) {
        retrieval.issues.push({
          stage: "crawl",
          code: "NO_RELEVANT_EVIDENCE_PASSAGES",
          message:
            "Public pages were retrieved, but their text did not contain a model-specific passage relevant to the category research criteria.",
        });
      }
      if (process.env.NODE_ENV === "development") {
        console.info("VETO evidence passage diagnostics", {
          retrievalOutcome: retrieval.outcome,
          pagesParsed: retrieval.diagnostics.crawl.parsedPageCount,
          ...built.diagnostics,
        });
      }
      return { retrieval, evidence: built.records };
    })();
    retrievalInFlight.set(key, promise);
  }

  try {
    const result = await promise;
    retrievalCache.set(key, {
      ...result,
      expiresAt: Date.now() + retrievalCacheTtl(result.retrieval, result.evidence),
    });
    return { ...result, cacheHit: false };
  } finally {
    if (retrievalInFlight.get(key) === promise) retrievalInFlight.delete(key);
  }
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

function noCandidateResponse(): InvestigationResponse {
  const timestamp = new Date().toISOString();
  return {
    status: "NO_EVIDENCE",
    shortlist: [],
    evidence: [],
    searchContexts: [],
    productAnalyses: [],
    challenger: null,
    verdict: {
      decision: "not_enough_evidence",
      bestMatchCandidateId: null,
      headline: "Not enough evidence to recommend confidently",
      rationale: "No discovered candidate passed the buyer's explicit hard constraints.",
      worthConsidering: [],
      whatVetoChallenged: [],
      remainsUnverified: ["No eligible candidate was available for source investigation."],
      evidenceIds: [],
    },
    issues: [{
      stage: "search",
      code: "NO_ELIGIBLE_CANDIDATES",
      message: "No discovered product passed the explicit hard constraints for investigation.",
    }],
    communityEvidence: {
      status: "unavailable",
      reason: "Community retrieval is not enabled in this bounded first evidence milestone.",
    },
    workflow: [
      { stage: "buyer_interpreter", status: "completed" },
      { stage: "category_expert", status: "completed" },
      { stage: "product_finder", status: "completed" },
      { stage: "evidence_retrieval", status: "no_evidence" },
      { stage: "evidence_analyst", status: "not_run" },
      { stage: "challenger", status: "upcoming" },
      { stage: "final_judge", status: "upcoming" },
    ],
    diagnostics: emptyDiagnostics(),
    meta: {
      investigatedAt: timestamp,
      retrievalTimestamp: timestamp,
      cacheHit: false,
      cached: false,
      googleSearchRunId: null,
      websiteCrawlerRunId: null,
      ragWebBrowserRunIds: [],
      evidenceAnalystExecuted: false,
      challengerExecuted: false,
      finalJudgeExecuted: false,
      modelsInvestigated: 0,
      pagesRetrieved: 0,
    },
  };
}

async function performInvestigation(
  input: InvestigationRequest,
  apifyToken: string,
  geminiKey: string,
): Promise<InvestigationResponse> {
  const shortlist = shortlistProducts(input.products, input.buyerProfile, input.categoryFramework);
  if (shortlist.length === 0) return noCandidateResponse();

  const key = cacheKey(input);
  const result = await getRetrieval(key, shortlist, input, apifyToken);
  const issues = [...result.retrieval.issues, {
    stage: "community" as const,
    code: "COMMUNITY_DEFERRED",
    message: "Community evidence is unavailable in this bounded first version; no owner consensus is inferred.",
  }];
  let productAnalyses: InvestigationResponse["productAnalyses"] = [];
  let evidenceAnalystExecuted = false;
  let challenger: InvestigationResponse["challenger"] = null;
  let challengerExecuted = false;
  let finalJudgeExecuted = false;
  let verdict: FinalVerdict = {
    decision: "not_enough_evidence",
    bestMatchCandidateId: null,
    headline: "Not enough evidence to recommend confidently",
    rationale: "VETO could not retrieve and validate enough model-specific evidence for a responsible recommendation.",
    worthConsidering: [],
    whatVetoChallenged: [],
    remainsUnverified: shortlist.flatMap((candidate) => candidate.unverifiedAttributes).slice(0, 10),
    evidenceIds: [],
  };

  if (result.evidence.length > 0) {
    try {
      productAnalyses = await analyzeEvidence(
        input.buyerProfile,
        input.categoryFramework,
        shortlist,
        result.evidence,
        geminiKey,
      );
      evidenceAnalystExecuted = true;
    } catch (error) {
      issues.push({
        stage: "analysis",
        code: error instanceof GeminiAgentError ? error.code : "EVIDENCE_ANALYSIS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "The evidence analyst failed; retrieved source passages remain available.",
      });
    }
  } else {
    issues.push({
      stage: "analysis",
      code: "EVIDENCE_ANALYST_NOT_RUN",
      message: "The Evidence Analyst was not called because no usable source passages were retrieved.",
    });
  }

  if (evidenceAnalystExecuted) {
    try {
      challenger = await challengeCandidates(
        input.buyerProfile,
        shortlist,
        result.evidence,
        productAnalyses,
        geminiKey,
      );
      challengerExecuted = true;
    } catch (error) {
      issues.push({
        stage: "analysis",
        code: error instanceof GeminiAgentError ? error.code : "CHALLENGER_FAILED",
        message: "The Challenger could not produce validated output; no final preference was inferred.",
      });
    }
  }

  const preliminaryEvidenceStatus = deriveEvidenceStatus({
    shortlist,
    evidence: result.evidence,
    retrievalOutcome: result.retrieval.outcome,
    evidenceAnalystExecuted,
    parsedPageCount: result.retrieval.diagnostics.crawl.parsedPageCount,
    selectedSourceCount: result.retrieval.diagnostics.search.selectedSourceCount,
  });
  if (challenger) {
    try {
      verdict = await judgeCandidates(
        input.buyerProfile,
        shortlist,
        result.evidence,
        productAnalyses,
        challenger,
        geminiKey,
      );
      if (preliminaryEvidenceStatus !== "COMPLETED" && verdict.decision === "best_match") {
        verdict = {
          ...verdict,
          decision: "conditional",
          headline: `Conditional choice: ${verdict.headline}`,
        };
      }
      finalJudgeExecuted = true;
    } catch (error) {
      issues.push({
        stage: "analysis",
        code: error instanceof GeminiAgentError ? error.code : "FINAL_JUDGE_FAILED",
        message: "The Final Judge could not produce a validated verdict; the result remains inconclusive.",
      });
    }
  }

  const status = deriveEvidenceStatus({
    shortlist,
    evidence: result.evidence,
    retrievalOutcome: result.retrieval.outcome,
    evidenceAnalystExecuted,
    parsedPageCount: result.retrieval.diagnostics.crawl.parsedPageCount,
    selectedSourceCount: result.retrieval.diagnostics.search.selectedSourceCount,
  });
  const retrievalWorkflowStatus =
    status === "RETRIEVAL_FAILED"
      ? "failed"
      : status === "NO_EVIDENCE"
        ? "no_evidence"
        : status === "PARTIAL_EVIDENCE"
          ? "partial"
          : "completed";

  return {
    status,
    shortlist,
    evidence: result.evidence,
    searchContexts: result.retrieval.searchContexts,
    productAnalyses,
    challenger,
    verdict,
    issues,
    communityEvidence: {
      status: "unavailable",
      reason: "Community retrieval is not enabled in this bounded first evidence milestone.",
    },
    workflow: [
      { stage: "buyer_interpreter", status: "completed" },
      { stage: "category_expert", status: "completed" },
      { stage: "product_finder", status: "completed" },
      { stage: "evidence_retrieval", status: retrievalWorkflowStatus },
      {
        stage: "evidence_analyst",
        status: evidenceAnalystExecuted
          ? "completed"
          : result.evidence.length > 0
            ? "failed"
            : "not_run",
      },
      {
        stage: "challenger",
        status: challengerExecuted ? "completed" : result.evidence.length > 0 ? "failed" : "not_run",
      },
      {
        stage: "final_judge",
        status: finalJudgeExecuted ? "completed" : challengerExecuted ? "failed" : "not_run",
      },
    ],
    diagnostics: result.retrieval.diagnostics,
    meta: {
      investigatedAt: new Date().toISOString(),
      retrievalTimestamp: result.retrieval.retrievalTimestamp,
      cacheHit: result.cacheHit,
      cached: result.cacheHit,
      googleSearchRunId: result.retrieval.googleSearchRunId,
      websiteCrawlerRunId: result.retrieval.websiteCrawlerRunId,
      ragWebBrowserRunIds: result.retrieval.ragWebBrowserRunIds,
      evidenceAnalystExecuted,
      challengerExecuted,
      finalJudgeExecuted,
      modelsInvestigated: shortlist.length,
      pagesRetrieved: result.retrieval.sources.length,
    },
  };
}

function cachedResponse(response: InvestigationResponse): InvestigationResponse {
  return {
    ...response,
    meta: { ...response.meta, cacheHit: true, cached: true },
  };
}

export async function investigateProducts(
  input: InvestigationRequest,
  apifyToken: string,
  geminiKey: string,
): Promise<InvestigationResponse> {
  const key = cacheKey(input);
  pruneCache(investigationCache);
  const cached = investigationCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cachedResponse(cached.response);

  let promise = investigationInFlight.get(key);
  if (!promise) {
    promise = performInvestigation(input, apifyToken, geminiKey);
    investigationInFlight.set(key, promise);
  }
  try {
    const response = await promise;
    investigationCache.set(key, {
      response,
      expiresAt: Date.now() + cacheTtl(response.status),
    });
    return response;
  } finally {
    if (investigationInFlight.get(key) === promise) investigationInFlight.delete(key);
  }
}
