import { findProductCandidates, ProductProviderError } from "@/lib/products/apify";
import { extractPriceConstraint } from "@/lib/products/price-constraint";
import type { ProductSearchError, ProductSearchResponse } from "@/lib/products/types";

const MAX_QUERY_LENGTH = 240;
const MAX_BUDGET = 100_000;

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ error: message, code } satisfies ProductSearchError, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Send a valid JSON request.", 400, "INVALID_JSON");
  }

  if (typeof body !== "object" || body === null) {
    return errorResponse("Request body must be an object.", 400, "INVALID_BODY");
  }

  const { query: rawQuery, searchQuery: rawSearchQuery, budget: rawBudget } = body as Record<
    string,
    unknown
  >;
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  const searchQuery = typeof rawSearchQuery === "string" ? rawSearchQuery.trim() : query;
  const suppliedBudget = typeof rawBudget === "number" ? rawBudget : null;

  if (!query) return errorResponse("Tell us what you want to buy.", 400, "QUERY_REQUIRED");
  if (query.length > MAX_QUERY_LENGTH) {
    return errorResponse(
      `Keep your request under ${MAX_QUERY_LENGTH} characters.`,
      400,
      "QUERY_TOO_LONG",
    );
  }
  if (!searchQuery || searchQuery.length > MAX_QUERY_LENGTH) {
    return errorResponse(
      `Discovery query must contain 1-${MAX_QUERY_LENGTH} characters.`,
      400,
      "INVALID_SEARCH_QUERY",
    );
  }
  if (
    rawBudget !== undefined &&
    (suppliedBudget === null ||
      !Number.isFinite(suppliedBudget) ||
      suppliedBudget <= 0 ||
      suppliedBudget > MAX_BUDGET)
  ) {
    return errorResponse(
      `Budget must be between $0.01 and $${MAX_BUDGET.toLocaleString("en-US")}.`,
      400,
      "INVALID_BUDGET",
    );
  }

  const priceConstraint =
    suppliedBudget !== null
      ? { kind: "hard" as const, amount: suppliedBudget, matchedText: null }
      : extractPriceConstraint(query);

  if (priceConstraint.amount !== null && priceConstraint.amount > MAX_BUDGET) {
    return errorResponse(
      `Price constraints must not exceed $${MAX_BUDGET.toLocaleString("en-US")}.`,
      400,
      "INVALID_BUDGET",
    );
  }

  const hardBudget = priceConstraint.kind === "hard" ? priceConstraint.amount : null;

  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return errorResponse(
      "Product search is not configured yet. Add APIFY_API_TOKEN to the server environment.",
      503,
      "MISSING_APIFY_TOKEN",
    );
  }

  try {
    const result = await findProductCandidates(searchQuery, hardBudget, token);
    const products = result.products.slice(0, 12);
    const response: ProductSearchResponse = {
      query,
      budget: hardBudget,
      priceConstraint,
      products,
      meta: {
        actorRunId: result.actorRunId,
        sourceTimestamp: result.sourceTimestamp,
        cached: result.cached,
        discoveryQuery: searchQuery,
        discoveredCount: products.length,
        withinBudgetCount: products.filter((product) => product.withinBudget).length,
      },
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProductProviderError) {
      return errorResponse(error.message, error.status, error.code);
    }
    return errorResponse("Product search failed unexpectedly. Please try again.", 500, "SEARCH_FAILED");
  }
}
