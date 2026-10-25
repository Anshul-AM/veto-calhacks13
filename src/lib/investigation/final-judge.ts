import { generateStructuredJson } from "@/lib/agents/gemini";
import type { BuyerProfile } from "@/lib/agents/types";
import type {
  ChallengerResult,
  EvidenceRecord,
  FinalVerdict,
  ProductEvidenceAnalysis,
  ShortlistedCandidate,
} from "./types";

const schema = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["best_match", "conditional", "not_enough_evidence"] },
    bestMatchCandidateId: { type: "string", nullable: true },
    headline: { type: "string" },
    rationale: { type: "string" },
    worthConsidering: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          candidateId: { type: "string" },
          reason: { type: "string" },
          conditions: { type: "array", maxItems: 5, items: { type: "string" } },
        },
        required: ["candidateId", "reason", "conditions"],
      },
    },
    whatVetoChallenged: { type: "array", maxItems: 8, items: { type: "string" } },
    remainsUnverified: { type: "array", maxItems: 10, items: { type: "string" } },
    evidenceIds: { type: "array", maxItems: 8, items: { type: "string" } },
  },
  required: ["decision", "bestMatchCandidateId", "headline", "rationale", "worthConsidering", "whatVetoChallenged", "remainsUnverified", "evidenceIds"],
} satisfies Record<string, unknown>;

const SYSTEM = `You are VETO's Final Judge, an independent buyer advocate.
Return a cautious consumer verdict using only the validated buyer brief, shortlisted candidates, source-backed evidence analysis, and Challenger findings.

Rules:
- Never invent facts, flaws, comparisons, availability, sizing, colors, owner experience, or citations.
- Category criteria and search snippets are not evidence.
- Respect every deterministic hard constraint. Soft price targets affect value but do not automatically disqualify.
- Do not assume men's and women's US sizes are interchangeable.
- Use "best_match" only when evidence supports a meaningful buyer-specific distinction.
- Use "conditional" when one option is provisionally stronger but important fit, variant, or source gaps remain.
- Use "not_enough_evidence" when retrieved evidence cannot justify a responsible recommendation.
- Cite only supplied evidence IDs. Keep remaining uncertainties explicit.`;

type RecordValue = Record<string, unknown>;
const asRecord = (value: unknown): RecordValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected object.");
  return value as RecordValue;
};
const text = (value: unknown, max = 900) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error("Invalid text.");
  return value.trim();
};
const list = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid array.");
  return value;
};

function validate(
  value: unknown,
  buyer: BuyerProfile,
  shortlist: ShortlistedCandidate[],
  evidence: EvidenceRecord[],
): FinalVerdict {
  const root = asRecord(value);
  const candidateIds = new Set(shortlist.map((candidate) => candidate.candidateId));
  const evidenceIdsAllowed = new Set(evidence.map((entry) => entry.evidenceId));
  const decision = text(root.decision, 30) as FinalVerdict["decision"];
  if (!["best_match", "conditional", "not_enough_evidence"].includes(decision)) throw new Error("Invalid verdict.");
  const bestMatchCandidateId = root.bestMatchCandidateId === null ? null : text(root.bestMatchCandidateId, 80);
  if (bestMatchCandidateId !== null && !candidateIds.has(bestMatchCandidateId)) throw new Error("Unknown best match.");
  if (decision !== "not_enough_evidence" && bestMatchCandidateId === null) throw new Error("Verdict lacks candidate.");
  if (decision === "not_enough_evidence" && bestMatchCandidateId !== null) throw new Error("Inconclusive verdict cannot select a winner.");
  const bestMatch = shortlist.find((candidate) => candidate.candidateId === bestMatchCandidateId);
  if (
    bestMatch &&
    buyer.priceConstraint.kind === "hard" &&
    (bestMatch.price === null || bestMatch.price > (buyer.priceConstraint.amount ?? 0))
  ) {
    throw new Error("Selected candidate does not establish compliance with the hard price limit.");
  }
  const worthConsidering = list(root.worthConsidering, 2).map((raw) => {
    const item = asRecord(raw);
    const candidateId = text(item.candidateId, 80);
    if (!candidateIds.has(candidateId)) throw new Error("Unknown considered candidate.");
    return {
      candidateId,
      reason: text(item.reason),
      conditions: list(item.conditions, 5).map((condition) => text(condition, 500)),
    };
  });
  const evidenceIds = list(root.evidenceIds, 8).map((id) => text(id, 80));
  if (evidenceIds.some((id) => !evidenceIdsAllowed.has(id))) throw new Error("Unknown verdict evidence.");
  if (decision !== "not_enough_evidence") {
    const bestMatchEvidence = evidence.filter(
      (entry) => entry.candidateId === bestMatchCandidateId,
    );
    if (!evidenceIds.some((id) => bestMatchEvidence.some((entry) => entry.evidenceId === id))) {
      throw new Error("Selected candidate lacks cited model-specific evidence.");
    }
  }
  return {
    decision,
    bestMatchCandidateId,
    headline: text(root.headline, 240),
    rationale: text(root.rationale),
    worthConsidering,
    whatVetoChallenged: list(root.whatVetoChallenged, 8).map((item) => text(item, 600)),
    remainsUnverified: list(root.remainsUnverified, 10).map((item) => text(item, 600)),
    evidenceIds,
  };
}

export async function judgeCandidates(
  buyer: BuyerProfile,
  shortlist: ShortlistedCandidate[],
  evidence: EvidenceRecord[],
  analyses: ProductEvidenceAnalysis[],
  challenger: ChallengerResult,
  apiKey: string,
): Promise<FinalVerdict> {
  return generateStructuredJson({
    apiKey,
    systemInstruction: SYSTEM,
    prompt: `Render the final bounded verdict:\n${JSON.stringify({ buyer, shortlist, evidence, analyses, challenger })}`,
    schema,
    validate: (value) => validate(value, buyer, shortlist, evidence),
  });
}
