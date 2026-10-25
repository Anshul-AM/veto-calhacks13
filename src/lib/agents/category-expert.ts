import { generateStructuredJson } from "./gemini";
import { categoryExpertSchema } from "./schemas";
import type { BuyerProfile, CategoryFramework } from "./types";
import { validateCategoryFramework } from "./validate";

const SYSTEM_INSTRUCTION = `You are VETO's Category Expert.
Your responsibility is to define how products in the identified category should later be investigated for this buyer.

Rules:
- Build a category-aware evaluation framework tailored to the supplied buyer brief.
- Identify criteria, common types of failure, claims that require verification, personalized fit questions, and useful alternative angles.
- Do not claim that any product has been researched.
- Do not claim that reviews, owner reports, tests, specifications, availability, or manufacturer claims have been checked.
- Do not recommend, rank, approve, or veto a product.
- Phrase evidenceNeeded, warningSigns, and claimsToVerify as future research targets, never as findings.
- Use general category expertise only to design the investigation.`;

export async function buildCategoryFramework(
  buyerProfile: BuyerProfile,
  apiKey: string,
): Promise<CategoryFramework> {
  const prompt = `Validated buyer brief:\n${JSON.stringify(
    buyerProfile,
  )}\n\nCreate the category evaluation framework. This is a research plan, not evidence.`;

  return generateStructuredJson({
    apiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    schema: categoryExpertSchema,
    validate: (value) => validateCategoryFramework(value, buyerProfile.productCategory),
  });
}
