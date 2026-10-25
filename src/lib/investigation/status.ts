import type {
  EvidenceRecord,
  InvestigationEvidenceStatus,
  ShortlistedCandidate,
} from "./types";

export function deriveEvidenceStatus({
  shortlist,
  evidence,
  retrievalOutcome,
  evidenceAnalystExecuted,
  parsedPageCount,
  selectedSourceCount,
}: {
  shortlist: ShortlistedCandidate[];
  evidence: EvidenceRecord[];
  retrievalOutcome: "completed" | "no_evidence" | "failed";
  evidenceAnalystExecuted: boolean;
  parsedPageCount: number;
  selectedSourceCount: number;
}): InvestigationEvidenceStatus {
  if (evidence.length === 0) {
    return retrievalOutcome === "failed" ? "RETRIEVAL_FAILED" : "NO_EVIDENCE";
  }
  if (!evidenceAnalystExecuted) return "PARTIAL_EVIDENCE";

  const completeCandidateCoverage = shortlist.every((candidate) => {
    const types = new Set(
      evidence
        .filter((entry) => entry.candidateId === candidate.candidateId)
        .map((entry) => entry.sourceType),
    );
    return types.has("manufacturer") && types.has("independent");
  });
  const completePageCoverage = parsedPageCount === selectedSourceCount;
  return completeCandidateCoverage && completePageCoverage
    ? "COMPLETED"
    : "PARTIAL_EVIDENCE";
}
