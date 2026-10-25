import { extractPriceConstraint } from "@/lib/products/price-constraint";
import { interpretBuyerRequest } from "./buyer-interpreter";
import { buildCategoryFramework } from "./category-expert";
import { getGeminiModel } from "./gemini";
import type { BuyerAnalysisResponse } from "./types";

const CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 40;

type AnalysisCore = Omit<BuyerAnalysisResponse, "meta"> & {
  generatedAt: string;
};

const cache = new Map<string, { expiresAt: number; value: AnalysisCore }>();
const inFlight = new Map<string, Promise<AnalysisCore>>();

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

async function runAnalysis(query: string, apiKey: string): Promise<AnalysisCore> {
  const priceConstraint = extractPriceConstraint(query);
  const buyerProfile = await interpretBuyerRequest(query, priceConstraint, apiKey);
  const categoryFramework = await buildCategoryFramework(buyerProfile, apiKey);

  return {
    buyerProfile,
    categoryFramework,
    generatedAt: new Date().toISOString(),
  };
}

export async function analyzeBuyerRequest(
  query: string,
  apiKey: string,
): Promise<BuyerAnalysisResponse> {
  const key = `${getGeminiModel()}:${query.trim().toLocaleLowerCase("en-US")}`;
  pruneCache();

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      buyerProfile: cached.value.buyerProfile,
      categoryFramework: cached.value.categoryFramework,
      meta: {
        model: getGeminiModel(),
        generatedAt: cached.value.generatedAt,
        cached: true,
        modelCalls: 0,
      },
    };
  }

  let promise = inFlight.get(key);
  if (!promise) {
    promise = runAnalysis(query, apiKey);
    inFlight.set(key, promise);
  }

  try {
    const value = await promise;
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    return {
      buyerProfile: value.buyerProfile,
      categoryFramework: value.categoryFramework,
      meta: {
        model: getGeminiModel(),
        generatedAt: value.generatedAt,
        cached: false,
        modelCalls: 2,
      },
    };
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}
