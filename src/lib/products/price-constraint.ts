import type { PriceConstraint } from "./types";

const MONEY = "\\$\\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)";

const hardPatterns = [
  new RegExp(`(?:no more than|at most|maximum(?: budget)?(?: of| is)?|max(?:imum)? budget(?: of| is)?)\\s*${MONEY}`, "i"),
  new RegExp(`(?:must be|strictly)\\s*(?:under|below)\\s*${MONEY}`, "i"),
  new RegExp(`(?:under|below)\\s*${MONEY}\\s*[,;—-]?\\s*(?:no exceptions|hard limit|firm)`, "i"),
];

const softPatterns = [
  new RegExp(`(?:around|about|roughly|approximately|near)\\s*${MONEY}`, "i"),
  new RegExp(`(?:ideally|preferably)\\s*(?:under|below|around|about)?\\s*${MONEY}`, "i"),
  new RegExp(`(?:target(?:ing)?|budget(?: is| of)?|looking to spend)\\s*(?:around|about|roughly)?\\s*${MONEY}`, "i"),
];

function matchConstraint(query: string, patterns: RegExp[], kind: "hard" | "soft") {
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (!match) continue;
    const amount = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(amount) && amount > 0) {
      return { kind, amount, matchedText: match[0] } satisfies PriceConstraint;
    }
  }
  return null;
}

/**
 * Deliberately narrow and deterministic. Ambiguous price language is left alone
 * until a reasoning model can evaluate it with the rest of the request.
 */
export function extractPriceConstraint(query: string): PriceConstraint {
  return (
    matchConstraint(query, hardPatterns, "hard") ??
    matchConstraint(query, softPatterns, "soft") ?? {
      kind: "none",
      amount: null,
      matchedText: null,
    }
  );
}
