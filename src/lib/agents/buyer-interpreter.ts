import type { PriceConstraint } from "@/lib/products/types";
import { generateStructuredJson } from "./gemini";
import { buyerInterpreterSchema } from "./schemas";
import type { BuyerProfile } from "./types";
import { AgentValidationError, validateBuyerProfile } from "./validate";

const SYSTEM_INSTRUCTION = `You are VETO's Buyer Interpreter.
Your only responsibility is to translate the buyer's own words into a structured brief for later product discovery and research.

Rules:
- Preserve the buyer's priorities, intended uses, tradeoffs, constraints, and uncertainty.
- Do not research products, cite reviews, evaluate listings, recommend brands, rank products, or issue a verdict.
- Do not invent needs the buyer did not state or directly imply.
- Treat only unmistakably non-negotiable language as a hard constraint.
- Treat words such as around, preferably, ideally, and open to as flexible.
- The supplied deterministic price classification is authoritative.
- discoveryQuery must be a concise shopping query, not an instruction to investigate or recommend.
- Put materially missing information in ambiguities instead of guessing.`;

export async function interpretBuyerRequest(
  query: string,
  priceConstraint: PriceConstraint,
  apiKey: string,
): Promise<BuyerProfile> {
  const prompt = `Buyer request:\n${query}\n\nDeterministic price classification:\n${JSON.stringify(
    priceConstraint,
  )}\n\nCreate the structured buyer brief.`;

  return generateStructuredJson({
    apiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    schema: buyerInterpreterSchema,
    validate: (value) => {
      try {
        return validateBuyerProfile(value, priceConstraint);
      } catch (error) {
        if (process.env.NODE_ENV === "development" && error instanceof AgentValidationError) {
          console.error("VETO Buyer Interpreter validation failed", { field: error.message });
        }
        throw error;
      }
    },
  });
}
