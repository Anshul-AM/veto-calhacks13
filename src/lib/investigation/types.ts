import type { BuyerProfile, CategoryFramework } from "@/lib/agents/types";
import type { ProductCandidate } from "@/lib/products/types";

export type ShortlistedCandidate = {
  candidateId: string;
  exactModel: string;
  title: string;
  merchant: string | null;
  price: number | null;
  rating: number | null;
  ratingCount: number | null;
  imageUrl: string | null;
  discoverySourceUrl: string | null;
  shortlistReasons: string[];
  unverifiedAttributes: string[];
};

export type EvidenceSourceType = "manufacturer" | "independent" | "community" | "retailer";
export type EvidenceClaimStatus = "supported" | "contradicted" | "conditional" | "unverified";

export type EvidenceRecord = {
  evidenceId: string;
  candidateId: string;
  exactModel: string;
  sourceTitle: string;
  originalUrl: string;
  domain: string;
  sourceType: EvidenceSourceType;
  retrievalTimestamp: string;
  passage: string;
  claimsAddressed: string[];
};

export type AnalyzedClaim = {
  claim: string;
  status: EvidenceClaimStatus;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  buyerImplication: string;
};

export type ProductEvidenceAnalysis = {
  candidateId: string;
  exactModel: string;
  claims: AnalyzedClaim[];
  importantCaveats: string[];
  missingInformation: string[];
  sourceQualityLimitations: string[];
};

export type ChallengerFinding = {
  candidateId: string;
  concern: string;
  basis: "evidence" | "constraint" | "uncertainty";
  severity: "high" | "medium" | "low";
  evidenceIds: string[];
  buyerImpact: string;
};

export type ChallengerResult = {
  findings: ChallengerFinding[];
  provisionalRanking: Array<{
    candidateId: string;
    position: 1 | 2;
    reason: string;
  }>;
  unresolvedQuestions: string[];
};

export type FinalVerdict = {
  decision: "best_match" | "conditional" | "not_enough_evidence";
  bestMatchCandidateId: string | null;
  headline: string;
  rationale: string;
  worthConsidering: Array<{
    candidateId: string;
    reason: string;
    conditions: string[];
  }>;
  whatVetoChallenged: string[];
  remainsUnverified: string[];
  evidenceIds: string[];
};

export type RetrievalIssue = {
  stage: "search" | "crawl" | "community" | "analysis";
  code: string;
  message: string;
};

export type InvestigationEvidenceStatus =
  | "COMPLETED"
  | "PARTIAL_EVIDENCE"
  | "NO_EVIDENCE"
  | "RETRIEVAL_FAILED";

export type SearchResultContext = {
  candidateId: string;
  exactModel: string;
  title: string;
  url: string;
  domain: string;
  sourceType: EvidenceSourceType;
  snippet: string | null;
};

export type InvestigationDiagnostics = {
  search: {
    launched: boolean;
    finalStatus: string | null;
    datasetItemCount: number;
    errorRowCount: number;
    organicResultCount: number;
    candidateUrlCount: number;
    selectedSourceCount: number;
    rejectedUrlCounts: Record<string, number>;
  };
  crawl: {
    launched: boolean;
    finalStatus: string | null;
    datasetItemCount: number;
    pagesWithContent: number;
    parsedPageCount: number;
    rejectedPageCounts: Record<string, number>;
  };
  evidence: {
    candidatePassageCount: number;
    relevantPassageCount: number;
    retainedPassageCount: number;
  };
};

export type InvestigationResponse = {
  status: InvestigationEvidenceStatus;
  shortlist: ShortlistedCandidate[];
  evidence: EvidenceRecord[];
  searchContexts: SearchResultContext[];
  productAnalyses: ProductEvidenceAnalysis[];
  challenger: ChallengerResult | null;
  verdict: FinalVerdict;
  issues: RetrievalIssue[];
  communityEvidence: {
    status: "unavailable";
    reason: string;
  };
  workflow: Array<{
    stage: "buyer_interpreter" | "category_expert" | "product_finder" | "evidence_retrieval" | "evidence_analyst" | "challenger" | "final_judge";
    status: "completed" | "partial" | "no_evidence" | "failed" | "not_run" | "upcoming";
  }>;
  diagnostics: InvestigationDiagnostics;
  meta: {
    investigatedAt: string;
    retrievalTimestamp: string;
    cacheHit: boolean;
    cached: boolean;
    googleSearchRunId: string | null;
    websiteCrawlerRunId: string | null;
    ragWebBrowserRunIds: string[];
    evidenceAnalystExecuted: boolean;
    challengerExecuted: boolean;
    finalJudgeExecuted: boolean;
    modelsInvestigated: number;
    pagesRetrieved: number;
  };
};

export type InvestigationRequest = {
  query: string;
  buyerProfile: BuyerProfile;
  categoryFramework: CategoryFramework;
  products: ProductCandidate[];
};

export type InvestigationApiError = {
  error: string;
  code?: string;
};
