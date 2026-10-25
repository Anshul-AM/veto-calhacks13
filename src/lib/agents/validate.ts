import type { PriceConstraint } from "@/lib/products/types";
import type {
  BuyerConstraint,
  BuyerPreference,
  BuyerPriority,
  BuyerProfile,
  CategoryFailureMode,
  CategoryFramework,
  EvaluationCriterion,
} from "./types";

type UnknownRecord = Record<string, unknown>;

export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentValidationError";
  }
}

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentValidationError(`${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function string(value: unknown, field: string, maxLength = 240): string {
  if (typeof value !== "string") throw new AgentValidationError(`${field} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new AgentValidationError(`${field} must contain 1-${maxLength} characters.`);
  }
  return trimmed;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new AgentValidationError(`${field} must be a boolean.`);
  return value;
}

function array(value: unknown, field: string, maxItems: number, minItems = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw new AgentValidationError(`${field} must contain ${minItems}-${maxItems} items.`);
  }
  return value;
}

function stringArray(value: unknown, field: string, maxItems: number, minItems = 0): string[] {
  return array(value, field, maxItems, minItems).map((item, index) =>
    string(item, `${field}[${index}]`),
  );
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new AgentValidationError(`${field} has an unsupported value.`);
  }
  return value as T;
}

const isPriceAttribute = (attribute: string) => /budget|price|cost|spend/i.test(attribute);

function validatePriorities(value: unknown): BuyerPriority[] {
  return array(value, "priorities", 8).map((item, index) => {
    const entry = record(item, `priorities[${index}]`);
    return {
      name: string(entry.name, `priorities[${index}].name`),
      importance: enumValue(entry.importance, `priorities[${index}].importance`, [
        "must-have",
        "high",
        "medium",
        "low",
      ] as const),
      rationale: string(entry.rationale, `priorities[${index}].rationale`),
    };
  });
}

function validateConstraints(value: unknown): BuyerConstraint[] {
  return array(value, "hardConstraints", 8).map((item, index) => {
    const entry = record(item, `hardConstraints[${index}]`);
    return {
      attribute: string(entry.attribute, `hardConstraints[${index}].attribute`),
      value: string(entry.value, `hardConstraints[${index}].value`),
      reason: string(entry.reason, `hardConstraints[${index}].reason`),
    };
  });
}

function validatePreferences(value: unknown): BuyerPreference[] {
  return array(value, "softPreferences", 8).map((item, index) => {
    const entry = record(item, `softPreferences[${index}]`);
    return {
      attribute: string(entry.attribute, `softPreferences[${index}].attribute`),
      value: string(entry.value, `softPreferences[${index}].value`),
      flexibility: string(entry.flexibility, `softPreferences[${index}].flexibility`),
    };
  });
}

export function validateBuyerProfile(
  value: unknown,
  priceConstraint: PriceConstraint,
): BuyerProfile {
  const data = record(value, "buyerProfile");
  const hardConstraints = validateConstraints(data.hardConstraints).filter(
    (item) => !isPriceAttribute(item.attribute),
  );
  const softPreferences = validatePreferences(data.softPreferences).filter(
    (item) => !isPriceAttribute(item.attribute),
  );

  if (priceConstraint.kind === "hard" && priceConstraint.amount !== null) {
    hardConstraints.push({
      attribute: "Maximum price",
      value: `$${priceConstraint.amount}`,
      reason: "The buyer used explicit hard-limit language.",
    });
  }
  if (priceConstraint.kind === "soft" && priceConstraint.amount !== null) {
    softPreferences.push({
      attribute: "Price target",
      value: `Around $${priceConstraint.amount}`,
      flexibility: "A soft target; stronger overall fit can justify exceeding it.",
    });
  }

  return {
    productCategory: string(data.productCategory, "productCategory", 120),
    requestSummary: string(data.requestSummary, "requestSummary"),
    intendedUses: stringArray(data.intendedUses, "intendedUses", 6),
    priorities: validatePriorities(data.priorities),
    hardConstraints: hardConstraints.slice(0, 8),
    softPreferences: softPreferences.slice(0, 8),
    rejectedTradeoffs: stringArray(data.rejectedTradeoffs, "rejectedTradeoffs", 6),
    openToAlternatives: boolean(data.openToAlternatives, "openToAlternatives"),
    ambiguities: stringArray(data.ambiguities, "ambiguities", 6),
    discoveryQuery: string(data.discoveryQuery, "discoveryQuery", 180),
    priceConstraint,
  };
}

function validateCriteria(value: unknown): EvaluationCriterion[] {
  return array(value, "evaluationCriteria", 8, 3).map((item, index) => {
    const entry = record(item, `evaluationCriteria[${index}]`);
    return {
      name: string(entry.name, `evaluationCriteria[${index}].name`),
      priority: enumValue(entry.priority, `evaluationCriteria[${index}].priority`, [
        "critical",
        "important",
        "contextual",
      ] as const),
      whyItMatters: string(entry.whyItMatters, `evaluationCriteria[${index}].whyItMatters`),
      evidenceNeeded: stringArray(
        entry.evidenceNeeded,
        `evaluationCriteria[${index}].evidenceNeeded`,
        4,
      ),
    };
  });
}

function validateFailureModes(value: unknown): CategoryFailureMode[] {
  return array(value, "commonFailureModes", 6).map((item, index) => {
    const entry = record(item, `commonFailureModes[${index}]`);
    return {
      failure: string(entry.failure, `commonFailureModes[${index}].failure`),
      whoItAffects: string(entry.whoItAffects, `commonFailureModes[${index}].whoItAffects`),
      warningSigns: stringArray(
        entry.warningSigns,
        `commonFailureModes[${index}].warningSigns`,
        4,
      ),
    };
  });
}

export function validateCategoryFramework(
  value: unknown,
  productCategory: string,
): CategoryFramework {
  const data = record(value, "categoryFramework");
  string(data.category, "category", 120);

  return {
    category: productCategory,
    categorySummary: string(data.categorySummary, "categorySummary"),
    evaluationCriteria: validateCriteria(data.evaluationCriteria),
    commonFailureModes: validateFailureModes(data.commonFailureModes),
    claimsToVerify: stringArray(data.claimsToVerify, "claimsToVerify", 8),
    fitQuestions: stringArray(data.fitQuestions, "fitQuestions", 8),
    alternativeAngles: stringArray(data.alternativeAngles, "alternativeAngles", 6),
  };
}
