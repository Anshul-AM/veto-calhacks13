import type { ProductCandidate } from "./types";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : null;

const pick = (item: UnknownRecord, keys: string[]): unknown => {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
};

const text = (value: unknown): string | null => {
  if (typeof value === "string") {
    const cleaned = value.trim();
    return cleaned || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const numeric = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

const nonNegativeInteger = (value: unknown): number | null => {
  const parsed = numeric(value);
  return parsed !== null && parsed >= 0 ? Math.round(parsed) : null;
};

const safeUrl = (value: unknown): string | null => {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const nestedUrl = (value: unknown): string | null => {
  const record = asRecord(value);
  return record ? safeUrl(pick(record, ["url", "link", "src"])) : null;
};

export function normalizeProducts(
  rawItems: unknown[],
  sourceTimestamp: string,
  hardBudget: number | null,
): ProductCandidate[] {
  const seen = new Set<string>();
  const products: ProductCandidate[] = [];

  for (const rawItem of rawItems) {
    const item = asRecord(rawItem);
    if (!item) continue;

    const title = text(pick(item, ["title", "name", "productTitle", "product_name"]));
    if (!title) continue;

    const price = numeric(
      pick(item, ["price", "extracted_price", "currentPrice", "priceValue", "price_value"]),
    );
    const explicitId = text(
      pick(item, ["productId", "product_id", "id", "position", "offerId", "offer_id"]),
    );
    const sourceUrl =
      safeUrl(
        pick(item, [
          "productLink",
          "product_link",
          "link",
          "url",
          "sourceUrl",
          "source_url",
        ]),
      ) ?? nestedUrl(item.source);
    const imageUrl =
      safeUrl(
        pick(item, ["imageUrl", "image_url", "thumbnail", "image", "imageLink", "image_link"]),
      ) ?? nestedUrl(item.image);
    const productId = explicitId ?? sourceUrl ?? `${title.toLowerCase()}-${price ?? "unknown"}`;

    if (seen.has(productId)) continue;
    seen.add(productId);

    const rating = numeric(pick(item, ["rating", "stars", "productRating", "product_rating"]));
    products.push({
      title: title.slice(0, 240),
      price: price !== null && price >= 0 ? price : null,
      merchant:
        text(pick(item, ["source", "merchant", "seller", "store", "vendor"]))?.slice(0, 100) ??
        null,
      rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      ratingCount: nonNegativeInteger(
        pick(item, ["reviews", "reviewCount", "review_count", "ratingCount", "rating_count"]),
      ),
      imageUrl,
      productId,
      sourceUrl,
      sourceTimestamp,
      withinBudget: hardBudget === null || (price !== null && price <= hardBudget),
    });

    if (products.length === 12) break;
  }

  if (hardBudget === null) return products;

  // Preserve provider order within each group; price is a constraint here, not a ranking signal.
  return products.sort((a, b) => Number(b.withinBudget) - Number(a.withinBudget));
}
