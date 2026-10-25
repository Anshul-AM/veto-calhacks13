import { validateBuyerProfile, validateCategoryFramework } from "@/lib/agents/validate";
import type { ProductCandidate } from "@/lib/products/types";
import { extractPriceConstraint } from "@/lib/products/price-constraint";
import type { InvestigationRequest } from "./types";
import { safePublicUrl } from "./url-safety";

type UnknownRecord = Record<string, unknown>;

export class InvestigationValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "InvestigationValidationError";
  }
}

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvestigationValidationError(`${field} must be an object.`, "INVALID_INVESTIGATION_BODY");
  }
  return value as UnknownRecord;
}

function nullableNumber(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new InvestigationValidationError(`${field} is invalid.`, "INVALID_PRODUCT_DATA");
  }
  return value;
}

function nullableString(value: unknown, field: string, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new InvestigationValidationError(`${field} is invalid.`, "INVALID_PRODUCT_DATA");
  }
  return value.trim() || null;
}

function validateProduct(value: unknown, index: number, hardBudget: number | null): ProductCandidate {
  const data = record(value, `products[${index}]`);
  const title = nullableString(data.title, `products[${index}].title`, 240);
  const productId = nullableString(data.productId, `products[${index}].productId`, 500);
  if (!title || !productId) {
    throw new InvestigationValidationError(
      `products[${index}] must include a title and productId.`,
      "INVALID_PRODUCT_DATA",
    );
  }
  const price = nullableNumber(data.price, `products[${index}].price`, 0, 1_000_000);
  const rating = nullableNumber(data.rating, `products[${index}].rating`, 0, 5);
  const ratingCount = nullableNumber(data.ratingCount, `products[${index}].ratingCount`, 0, 1_000_000_000);
  const imageRaw = nullableString(data.imageUrl, `products[${index}].imageUrl`, 2_048);
  const sourceRaw = nullableString(data.sourceUrl, `products[${index}].sourceUrl`, 2_048);
  const sourceTimestamp = nullableString(
    data.sourceTimestamp,
    `products[${index}].sourceTimestamp`,
    100,
  );
  if (!sourceTimestamp) {
    throw new InvestigationValidationError(
      `products[${index}].sourceTimestamp is required.`,
      "INVALID_PRODUCT_DATA",
    );
  }
  return {
    title,
    productId,
    price,
    merchant: nullableString(data.merchant, `products[${index}].merchant`, 120),
    rating,
    ratingCount: ratingCount === null ? null : Math.round(ratingCount),
    imageUrl: imageRaw ? safePublicUrl(imageRaw) : null,
    sourceUrl: sourceRaw ? safePublicUrl(sourceRaw) : null,
    sourceTimestamp,
    withinBudget: hardBudget === null || (price !== null && price <= hardBudget),
  };
}

export function validateInvestigationRequest(value: unknown): InvestigationRequest {
  const data = record(value, "request");
  if (typeof data.query !== "string") {
    throw new InvestigationValidationError("query must be a string.", "QUERY_REQUIRED");
  }
  const query = data.query.trim();
  if (!query) throw new InvestigationValidationError("Tell VETO what you want to investigate.", "QUERY_REQUIRED");
  if (query.length > 240) {
    throw new InvestigationValidationError("Keep your request under 240 characters.", "QUERY_TOO_LONG");
  }
  const priceConstraint = extractPriceConstraint(query);
  let buyerProfile;
  let categoryFramework;
  try {
    buyerProfile = validateBuyerProfile(data.buyerProfile, priceConstraint);
    categoryFramework = validateCategoryFramework(data.categoryFramework, buyerProfile.productCategory);
  } catch {
    throw new InvestigationValidationError(
      "The supplied buyer analysis is invalid. Run product discovery again.",
      "INVALID_ANALYSIS_DATA",
    );
  }
  if (!Array.isArray(data.products) || data.products.length < 1 || data.products.length > 12) {
    throw new InvestigationValidationError(
      "Supply between 1 and 12 discovered products.",
      "INVALID_PRODUCTS",
    );
  }
  const hardBudget = priceConstraint.kind === "hard" ? priceConstraint.amount : null;
  const products = data.products.map((product, index) => validateProduct(product, index, hardBudget));
  return { query, buyerProfile, categoryFramework, products };
}
