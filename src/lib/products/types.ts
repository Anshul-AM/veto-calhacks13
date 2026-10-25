export type ProductCandidate = {
  title: string;
  price: number | null;
  merchant: string | null;
  rating: number | null;
  ratingCount: number | null;
  imageUrl: string | null;
  productId: string;
  sourceUrl: string | null;
  sourceTimestamp: string;
  withinBudget: boolean;
};

export type PriceConstraint = {
  kind: "hard" | "soft" | "none";
  amount: number | null;
  matchedText: string | null;
};

export type ProductSearchResponse = {
  query: string;
  budget: number | null;
  priceConstraint: PriceConstraint;
  products: ProductCandidate[];
  meta: {
    actorRunId: string;
    sourceTimestamp: string;
    cached: boolean;
    discoveryQuery: string;
    discoveredCount: number;
    withinBudgetCount: number;
  };
};

export type ProductSearchError = {
  error: string;
  code?: string;
};
