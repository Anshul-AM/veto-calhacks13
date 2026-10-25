import { createHash } from "node:crypto";
import type { CategoryFramework } from "@/lib/agents/types";
import type { CrawledSource } from "./apify-retrieval";
import type { EvidenceRecord, InvestigationDiagnostics } from "./types";

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "because", "been", "before", "being", "but",
  "can", "could", "does", "for", "from", "have", "how", "into", "its", "more", "not",
  "should", "that", "the", "their", "then", "this", "what", "when", "where", "which", "with",
]);
const MAX_PASSAGES_PER_SOURCE = 2;
const MAX_EVIDENCE_RECORDS = 8;
const MAX_PASSAGE_LENGTH = 520;
const MAX_SCORING_BLOCK_LENGTH = 1_800;
const MODEL_GENERIC_WORDS = new Set([
  "shoe", "shoes", "sneaker", "sneakers", "trainer", "trainers", "running", "walking",
  "road", "mens", "men", "womens", "women", "unisex", "adult", "black", "white", "blue",
  "red", "grey", "gray", "navy", "wide", "medium", "size", "color", "colour", "sale",
]);

function terms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function candidatePassages(content: string): string[] {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\r/g, "\n");
  const blocks = normalized
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((block) => block.replace(/[#*_>`|\[\]]/g, " ").replace(/\s+/g, " ").trim())
    .filter((block) => block.length >= 60)
    .flatMap((block) => {
      if (block.length <= MAX_SCORING_BLOCK_LENGTH) return [block];
      const chunks: string[] = [];
      for (let offset = 0; offset < block.length; offset += MAX_SCORING_BLOCK_LENGTH) {
        const chunk = block.slice(offset, offset + MAX_SCORING_BLOCK_LENGTH).trim();
        if (chunk.length >= 60) chunks.push(chunk);
      }
      return chunks;
    });

  return blocks.map((block) => {
    if (block.length <= MAX_PASSAGE_LENGTH) return block;
    const cut = block.slice(0, MAX_PASSAGE_LENGTH);
    const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    return (sentenceEnd > 300 ? cut.slice(0, sentenceEnd + 1) : cut).trim();
  });
}

function researchTargets(framework: CategoryFramework): string[] {
  return [
    ...framework.evaluationCriteria.map((criterion) => criterion.name),
    ...framework.evaluationCriteria.flatMap((criterion) => criterion.evidenceNeeded),
    ...framework.claimsToVerify,
  ].slice(0, 28);
}

function significantModelWords(
  value: string,
  limit = Number.POSITIVE_INFINITY,
  unique = true,
): string[] {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const identity: string[] = [];
  for (const [index, word] of words.entries()) {
    const followsSizeMarker = index > 0 && /^(?:size|us)$/.test(words[index - 1]);
    if (word.length < 2 || MODEL_GENERIC_WORDS.has(word) || followsSizeMarker) continue;
    if (!unique || !identity.includes(word)) identity.push(word);
    if (identity.length === limit) break;
  }
  return identity;
}

function modelIdentityTerms(model: string): string[] {
  return significantModelWords(model, 5);
}

function refersToExactModel(passage: string, model: string): boolean {
  const identity = modelIdentityTerms(model);
  if (identity.length === 0) return false;
  const passageTerms = significantModelWords(passage, Number.POSITIVE_INFINITY, false);
  return passageTerms.some((term, start) =>
    term === identity[0] && identity.every((expected, offset) => passageTerms[start + offset] === expected),
  );
}

function passageScore(passage: string, pageTitle: string, model: string, targets: string[]): number {
  const passageTerms = new Set(terms(passage));
  if (!refersToExactModel(pageTitle, model) && !refersToExactModel(passage, model)) return -1;
  const modelMatches = terms(model).filter((term) => passageTerms.has(term)).length;
  const targetMatches = targets.reduce((total, target) => {
    const targetTerms = terms(target);
    const overlap = targetTerms.filter((term) => passageTerms.has(term)).length;
    return total + (overlap >= Math.min(2, targetTerms.length) ? 2 : overlap > 0 ? 0.35 : 0);
  }, 0);
  if (targetMatches <= 0) return -1;
  return modelMatches * 3 + targetMatches;
}

function addressedClaims(passage: string, targets: string[]): string[] {
  const passageTerms = new Set(terms(passage));
  return targets
    .map((target) => ({
      target,
      overlap: terms(target).filter((term) => passageTerms.has(term)).length,
    }))
    .filter(({ overlap }) => overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 4)
    .map(({ target }) => target);
}

export function buildEvidenceRecords(
  sources: CrawledSource[],
  framework: CategoryFramework,
): {
  records: EvidenceRecord[];
  diagnostics: InvestigationDiagnostics["evidence"];
} {
  const targets = researchTargets(framework);
  const records: EvidenceRecord[] = [];
  const diagnostics: InvestigationDiagnostics["evidence"] = {
    candidatePassageCount: 0,
    relevantPassageCount: 0,
    retainedPassageCount: 0,
  };

  for (const source of sources) {
    const content = source.markdown || source.text;
    const candidates = candidatePassages(content);
    diagnostics.candidatePassageCount += candidates.length;
    const relevant = candidates
      .map((passage) => ({
        passage,
        score: passageScore(passage, source.pageTitle, source.exactModel, targets),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    diagnostics.relevantPassageCount += relevant.length;
    const ranked = relevant.slice(0, MAX_PASSAGES_PER_SOURCE);

    for (const { passage } of ranked) {
      const hash = createHash("sha256")
        .update(`${source.candidateId}|${source.finalUrl}|${passage}`)
        .digest("hex")
        .slice(0, 14);
      records.push({
        evidenceId: `ev_${hash}`,
        candidateId: source.candidateId,
        exactModel: source.exactModel,
        sourceTitle: source.pageTitle,
        originalUrl: source.finalUrl,
        domain: source.domain,
        sourceType: source.sourceType,
        retrievalTimestamp: source.retrievalTimestamp,
        passage,
        claimsAddressed: addressedClaims(passage, targets),
      });
      if (records.length === MAX_EVIDENCE_RECORDS) {
        diagnostics.retainedPassageCount = records.length;
        return { records, diagnostics };
      }
    }
  }

  diagnostics.retainedPassageCount = records.length;
  return { records, diagnostics };
}
