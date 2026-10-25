import { createHash } from "node:crypto";
import type { BuyerProfile, CategoryFramework } from "@/lib/agents/types";
import type { ProductCandidate } from "@/lib/products/types";
import type { ShortlistedCandidate } from "./types";

const VARIANT_WORDS = new Set([
  "black", "white", "blue", "red", "green", "grey", "gray", "navy", "pink", "purple",
  "wide", "medium", "narrow", "new", "sale", "size", "color", "colour",
]);
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "shoe", "shoes", "running", "walking", "road",
  "men", "mens", "women", "womens", "unisex", "adult", "pair",
]);

const words = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);

function modelKey(title: string): string {
  return words(title)
    .filter((word) => !VARIANT_WORDS.has(word) && !/^\d+(?:\.\d+)?$/.test(word))
    .slice(0, 8)
    .join(" ");
}

function relevanceTerms(buyer: BuyerProfile, framework: CategoryFramework): Set<string> {
  const source = [
    buyer.productCategory,
    ...buyer.intendedUses,
    ...buyer.priorities.map((item) => item.name),
    ...buyer.hardConstraints.flatMap((item) => [item.attribute, item.value]),
    ...buyer.softPreferences.flatMap((item) => [item.attribute, item.value]),
    ...framework.evaluationCriteria.map((item) => item.name),
  ].join(" ");
  return new Set(words(source).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

function shortlistScore(
  product: ProductCandidate,
  terms: Set<string>,
  buyer: BuyerProfile,
  index: number,
): number {
  const titleTerms = new Set(words(product.title));
  let score = Math.max(0, 10 - index * 0.6);
  for (const term of terms) if (titleTerms.has(term)) score += 2;
  if (product.rating !== null && product.ratingCount !== null) {
    const confidence = Math.min(1, Math.log10(product.ratingCount + 1) / 2.5);
    score += product.rating * confidence;
    if (product.ratingCount < 10) score -= 1.5;
  }
  if (
    buyer.priceConstraint.kind === "soft" &&
    buyer.priceConstraint.amount !== null &&
    product.price !== null
  ) {
    const ratio = product.price / buyer.priceConstraint.amount;
    if (ratio <= 1.15) score += 2;
    else if (ratio > 1.5) score -= 2;
  }
  if (product.sourceUrl) score += 1;
  return score;
}

function unverifiedAttributes(product: ProductCandidate, buyer: BuyerProfile): string[] {
  const title = product.title.toLowerCase();
  const attributes: string[] = [];
  const requested = [...buyer.hardConstraints, ...buyer.softPreferences];
  for (const item of requested) {
    if (!/size|color|colour|width|fit|gender|men|women/i.test(item.attribute)) continue;
    if (/size|color|colour|width|fit/i.test(item.attribute)) {
      attributes.push(`${item.attribute}: ${item.value} — availability and fit unverified`);
    } else if (!title.includes(item.value.toLowerCase())) {
      attributes.push(`${item.attribute}: ${item.value} — unverified`);
    }
  }
  const requestContext = [
    buyer.requestSummary,
    ...buyer.ambiguities,
    ...requested.flatMap((item) => [item.attribute, item.value]),
  ].join(" ");
  const hasSizeRequest = /\b(?:us\s*)?size\s*\d/i.test(requestContext) ||
    requested.some((item) => /size/i.test(item.attribute));
  const hasGenderRequest = /\b(?:men'?s|women'?s|male|female|unisex)\b/i.test(requestContext);
  if (hasSizeRequest && !hasGenderRequest && /\b(?:men'?s|women'?s)\b/i.test(product.title)) {
    attributes.push("Gender-specific US size conversion — buyer intent unclear");
  }
  if (buyer.priceConstraint.kind === "hard" && product.price === null) {
    attributes.push(`Price under $${buyer.priceConstraint.amount}: unverified`);
  }
  return [...new Set(attributes)].slice(0, 5);
}

function exactModel(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function shortlistProducts(
  products: ProductCandidate[],
  buyer: BuyerProfile,
  framework: CategoryFramework,
): ShortlistedCandidate[] {
  const terms = relevanceTerms(buyer, framework);
  const eligible = products
    .map((product, index) => ({
      product,
      index,
      score: shortlistScore(product, terms, buyer, index),
    }))
    .filter(
      ({ product }) =>
        buyer.priceConstraint.kind !== "hard" || product.price === null || product.withinBudget,
    )
    .sort((a, b) => b.score - a.score);
  const seenModels = new Set<string>();
  const shortlist: ShortlistedCandidate[] = [];

  for (const { product } of eligible) {
    const key = modelKey(product.title);
    if (!key || seenModels.has(key)) continue;
    seenModels.add(key);

    const matchedTerms = [...terms].filter((term) => words(product.title).includes(term)).slice(0, 3);
    shortlist.push({
      candidateId: `cand_${createHash("sha256").update(product.productId).digest("hex").slice(0, 12)}`,
      exactModel: exactModel(product.title),
      title: product.title,
      merchant: product.merchant,
      price: product.price,
      rating: product.rating,
      ratingCount: product.ratingCount,
      imageUrl: product.imageUrl,
      discoverySourceUrl: product.sourceUrl,
      shortlistReasons:
        matchedTerms.length > 0
          ? [`Discovery title matches: ${matchedTerms.join(", ")}.`, "Eligible for provisional investigation."]
          : ["Highest remaining discovery relevance after hard-constraint filtering."],
      unverifiedAttributes: unverifiedAttributes(product, buyer),
    });
    if (shortlist.length === 2) break;
  }

  return shortlist;
}
