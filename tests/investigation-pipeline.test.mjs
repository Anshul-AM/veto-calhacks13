import test from "node:test";
import assert from "node:assert/strict";
import { inspectPublicUrl } from "../src/lib/investigation/url-safety.ts";
import { buildEvidenceRecords } from "../src/lib/investigation/evidence.ts";
import { deriveEvidenceStatus } from "../src/lib/investigation/status.ts";

test("public URL inspection keeps explicit sanitized rejection categories", () => {
  assert.equal(inspectPublicUrl("http://localhost:3000").reason, "private_or_local_host");
  assert.equal(inspectPublicUrl("https://user:secret@example.com/").reason, "embedded_credentials");
  assert.equal(inspectPublicUrl("file:///tmp/source").reason, "unsupported_protocol");
  assert.equal(inspectPublicUrl("not a url").reason, "invalid_url");
  assert.equal(inspectPublicUrl("https://example.com/product#reviews").url, "https://example.com/product");
});

test("long crawler blocks are chunked instead of silently discarding relevant evidence", () => {
  const genericLead = "Generic navigation and catalog information. ".repeat(70);
  const modelEvidence =
    "Nike Pegasus 41 uses a cushioned midsole for daily road running. The product page documents the outsole material and intended daily training use.";
  const framework = {
    category: "road running shoes",
    categorySummary: "Research framework",
    evaluationCriteria: [{
      name: "Cushioning and durability",
      priority: "critical",
      whyItMatters: "The buyer prioritizes comfort and longevity.",
      evidenceNeeded: ["documented midsole construction", "outsole durability"],
    }],
    commonFailureModes: [],
    claimsToVerify: ["daily training cushioning"],
    fitQuestions: [],
    alternativeAngles: [],
  };
  const sources = [{
    candidateId: "cand_test",
    exactModel: "Nike Pegasus 41",
    query: "Nike Pegasus 41 official specifications",
    title: "Nike Pegasus 41",
    url: "https://www.nike.com/example",
    domain: "nike.com",
    sourceType: "manufacturer",
    searchSnippet: "",
    finalUrl: "https://www.nike.com/example",
    pageTitle: "Nike Pegasus 41",
    markdown: `${genericLead}${modelEvidence}`,
    text: "",
    retrievalTimestamp: "2026-10-25T00:00:00.000Z",
  }];

  const result = buildEvidenceRecords(sources, framework);
  assert.ok(result.diagnostics.candidatePassageCount > 1);
  assert.ok(result.diagnostics.relevantPassageCount > 0);
  assert.ok(result.records.length > 0);
  assert.equal(result.records[0].candidateId, "cand_test");
});

test("zero passages can never be reported as partial or complete evidence", () => {
  const base = {
    shortlist: [],
    evidence: [],
    evidenceAnalystExecuted: false,
    parsedPageCount: 0,
    selectedSourceCount: 0,
  };
  assert.equal(
    deriveEvidenceStatus({ ...base, retrievalOutcome: "no_evidence" }),
    "NO_EVIDENCE",
  );
  assert.equal(
    deriveEvidenceStatus({ ...base, retrievalOutcome: "failed" }),
    "RETRIEVAL_FAILED",
  );
});

test("evidence passages reject a related but different model", () => {
  const framework = {
    category: "walking shoes",
    categorySummary: "Research framework",
    evaluationCriteria: [{
      name: "Cushioning and durability",
      priority: "critical",
      whyItMatters: "Comfort and longevity matter.",
      evidenceNeeded: ["midsole construction"],
    }],
    commonFailureModes: [],
    claimsToVerify: ["walking comfort"],
    fitQuestions: [],
    alternativeAngles: [],
  };
  const sources = [{
    candidateId: "cand_reebok",
    exactModel: "Reebok DMX Comfort+",
    query: "Reebok DMX Comfort+ review",
    title: "Reebok DMX review",
    url: "https://example.com/reebok-dmx",
    domain: "example.com",
    sourceType: "independent",
    searchSnippet: "",
    finalUrl: "https://example.com/reebok-dmx",
    pageTitle: "Reebok DMX walking shoe review",
    markdown: "The Reebok DMX uses soft cushioning for walking comfort and describes its midsole construction in detail.",
    text: "",
    retrievalTimestamp: "2026-10-25T00:00:00.000Z",
  }];

  const result = buildEvidenceRecords(sources, framework);
  assert.equal(result.records.length, 0);
  assert.equal(result.diagnostics.relevantPassageCount, 0);
});
