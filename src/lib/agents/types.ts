import type { PriceConstraint } from "@/lib/products/types";

export type BuyerPriority = {
  name: string;
  importance: "must-have" | "high" | "medium" | "low";
  rationale: string;
};

export type BuyerConstraint = {
  attribute: string;
  value: string;
  reason: string;
};

export type BuyerPreference = {
  attribute: string;
  value: string;
  flexibility: string;
};

export type BuyerProfile = {
  productCategory: string;
  requestSummary: string;
  intendedUses: string[];
  priorities: BuyerPriority[];
  hardConstraints: BuyerConstraint[];
  softPreferences: BuyerPreference[];
  rejectedTradeoffs: string[];
  openToAlternatives: boolean;
  ambiguities: string[];
  discoveryQuery: string;
  priceConstraint: PriceConstraint;
};

export type EvaluationCriterion = {
  name: string;
  priority: "critical" | "important" | "contextual";
  whyItMatters: string;
  evidenceNeeded: string[];
};

export type CategoryFailureMode = {
  failure: string;
  whoItAffects: string;
  warningSigns: string[];
};

export type CategoryFramework = {
  category: string;
  categorySummary: string;
  evaluationCriteria: EvaluationCriterion[];
  commonFailureModes: CategoryFailureMode[];
  claimsToVerify: string[];
  fitQuestions: string[];
  alternativeAngles: string[];
};

export type BuyerAnalysisResponse = {
  buyerProfile: BuyerProfile;
  categoryFramework: CategoryFramework;
  meta: {
    model: string;
    generatedAt: string;
    cached: boolean;
    modelCalls: 0 | 2;
  };
};

export type AgentApiError = {
  error: string;
  code?: string;
};
