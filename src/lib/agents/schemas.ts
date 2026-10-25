type JsonSchema = Record<string, unknown>;

const shortString = (description: string): JsonSchema => ({
  type: "string",
  description,
  maxLength: 240,
});

const buyerString = (description: string, maxLength = 240): JsonSchema => ({
  type: "string",
  description,
  minLength: 1,
  maxLength,
});

export const buyerInterpreterSchema: JsonSchema = {
  type: "object",
  properties: {
    productCategory: buyerString("The most specific defensible product category.", 120),
    requestSummary: buyerString("A neutral summary of what the buyer asked for."),
    intendedUses: {
      type: "array",
      maxItems: 6,
      items: buyerString("A concrete use case stated or directly implied by the request."),
    },
    priorities: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          name: buyerString("The buyer priority."),
          importance: { type: "string", enum: ["must-have", "high", "medium", "low"] },
          rationale: buyerString("Why this importance follows from the request."),
        },
        required: ["name", "importance", "rationale"],
      },
    },
    hardConstraints: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          attribute: buyerString("Constraint attribute."),
          value: buyerString("Required value."),
          reason: buyerString("Why this is truly non-negotiable."),
        },
        required: ["attribute", "value", "reason"],
      },
    },
    softPreferences: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          attribute: buyerString("Preference attribute."),
          value: buyerString("Preferred value."),
          flexibility: buyerString("What tradeoff could justify deviating from it."),
        },
        required: ["attribute", "value", "flexibility"],
      },
    },
    rejectedTradeoffs: {
      type: "array",
      maxItems: 6,
      items: buyerString("A tradeoff the buyer explicitly rejects."),
    },
    openToAlternatives: { type: "boolean" },
    ambiguities: {
      type: "array",
      maxItems: 6,
      items: buyerString("Missing information that could materially affect the eventual decision."),
    },
    discoveryQuery: buyerString(
      "A concise Google Shopping query retaining the category and strongest product attributes, without research instructions.",
      180,
    ),
  },
  required: [
    "productCategory",
    "requestSummary",
    "intendedUses",
    "priorities",
    "hardConstraints",
    "softPreferences",
    "rejectedTradeoffs",
    "openToAlternatives",
    "ambiguities",
    "discoveryQuery",
  ],
};

export const categoryExpertSchema: JsonSchema = {
  type: "object",
  properties: {
    category: shortString("The product category this framework covers."),
    categorySummary: shortString(
      "A concise explanation of what generally determines quality and fit in this category, not a product finding.",
    ),
    evaluationCriteria: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          name: shortString("A category-specific evaluation criterion."),
          priority: { type: "string", enum: ["critical", "important", "contextual"] },
          whyItMatters: shortString("Why this criterion matters for this buyer."),
          evidenceNeeded: {
            type: "array",
            maxItems: 4,
            items: shortString("Evidence that a later research stage should collect."),
          },
        },
        required: ["name", "priority", "whyItMatters", "evidenceNeeded"],
      },
    },
    commonFailureModes: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          failure: shortString("A known type of category failure to investigate, not a claim about a candidate."),
          whoItAffects: shortString("Which usage patterns or buyers are most affected."),
          warningSigns: {
            type: "array",
            maxItems: 4,
            items: shortString("Signals a later evidence stage should look for."),
          },
        },
        required: ["failure", "whoItAffects", "warningSigns"],
      },
    },
    claimsToVerify: {
      type: "array",
      maxItems: 8,
      items: shortString("A manufacturer or listing claim that should be independently checked later."),
    },
    fitQuestions: {
      type: "array",
      maxItems: 8,
      items: shortString("A question needed to judge personalized fit."),
    },
    alternativeAngles: {
      type: "array",
      maxItems: 6,
      items: shortString("A neighboring product type or tradeoff worth considering later."),
    },
  },
  required: [
    "category",
    "categorySummary",
    "evaluationCriteria",
    "commonFailureModes",
    "claimsToVerify",
    "fitQuestions",
    "alternativeAngles",
  ],
};
