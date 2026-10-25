import test from "node:test";
import assert from "node:assert/strict";
import { buyerInterpreterSchema } from "../src/lib/agents/schemas.ts";
import { AgentValidationError, validateBuyerProfile } from "../src/lib/agents/validate.ts";

const baseProfile = {
  productCategory: "road running shoes",
  requestSummary: "Comfortable shoes for walking and occasional running.",
  intendedUses: ["daily walking", "occasional running"],
  priorities: [{
    name: "durability",
    importance: "high",
    rationale: "The buyer values longevity over style.",
  }],
  hardConstraints: [],
  softPreferences: [{
    attribute: "color",
    value: "black",
    flexibility: "Other colors are acceptable for a stronger overall fit.",
  }],
  rejectedTradeoffs: [],
  openToAlternatives: true,
  ambiguities: ["Gender-specific US sizing was not stated."],
  discoveryQuery: "comfortable durable walking running shoes size 10 black",
};

const noPriceConstraint = { kind: "none", amount: null, matchedText: null };

test("Buyer Interpreter schema matches runtime string bounds", () => {
  const properties = buyerInterpreterSchema.properties;
  assert.equal(properties.productCategory.minLength, 1);
  assert.equal(properties.productCategory.maxLength, 120);
  assert.equal(properties.discoveryQuery.minLength, 1);
  assert.equal(properties.discoveryQuery.maxLength, 180);

  const result = validateBuyerProfile(baseProfile, noPriceConstraint);
  assert.equal(result.discoveryQuery, baseProfile.discoveryQuery);
});

test("empty nested Buyer Interpreter strings remain invalid", () => {
  const payload = {
    ...baseProfile,
    softPreferences: [{ ...baseProfile.softPreferences[0], flexibility: "" }],
  };

  assert.throws(
    () => validateBuyerProfile(payload, noPriceConstraint),
    (error) => error instanceof AgentValidationError &&
      error.message === "softPreferences[0].flexibility must contain 1-240 characters.",
  );
});
