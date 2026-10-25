import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && context.parentURL) {
        const candidate = new URL(`${specifier}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
      }
      throw error;
    }
  },
});

const { inspectPublicUrl } = await import("../src/lib/investigation/url-safety.ts");
const { buildEvidenceRecords } = await import("../src/lib/investigation/evidence.ts");
const { deriveEvidenceStatus } = await import("../src/lib/investigation/status.ts");
const { fetchSourcePlan, selectSourcePlans } = await import(
  "../src/lib/investigation/apify-retrieval.ts"
);

const searchDiagnostics = () => ({
  launched: true,
  finalStatus: "SUCCEEDED",
  datasetItemCount: 0,
  errorRowCount: 0,
  organicResultCount: 0,
  candidateUrlCount: 0,
  selectedSourceCount: 0,
  rejectedUrlCounts: {},
});

const crawlDiagnostics = () => ({
  launched: true,
  finalStatus: null,
  datasetItemCount: 0,
  pagesWithContent: 0,
  parsedPageCount: 0,
  rejectedPageCounts: {},
});

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

test("source selection rejects mirrors, unrelated models, and retailer review listings", () => {
  const candidate = { candidateId: "cand_reebok", exactModel: "Reebok DMX Comfort+" };
  const officialQuery = `"Reebok DMX Comfort+" official specifications`;
  const reviewQuery = `"Reebok DMX Comfort+" independent review cushioning`;
  const queries = [
    { candidate, query: officialQuery, kind: "official" },
    { candidate, query: reviewQuery, kind: "review" },
  ];
  const diagnostics = searchDiagnostics();
  const items = [
    {
      searchQuery: { term: officialQuery },
      organicResults: [
        { title: "Reebok DMX Comfort+", url: "https://www.desertcart.example/reebok-dmx-comfort-plus" },
        { title: "Reebok DMX walking shoe", url: "https://www.reebok.com/us-en/p/dmx-walking" },
        { title: "Reebok DMX Comfort+", url: "https://www.reebok.com/us-en/p/dmx-comfort-plus" },
      ],
    },
    {
      searchQuery: { term: reviewQuery },
      organicResults: [
        { title: "Buy Reebok DMX Comfort+", url: "https://www.amazon.com/reebok-dmx-comfort-plus" },
        { title: "Reebok DMX Comfort+ Review", url: "https://runrepeat.com/reebok-dmx-comfort-plus" },
      ],
    },
  ];

  const plans = selectSourcePlans(items, queries, diagnostics);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].primary.domain, "reebok.com");
  assert.equal(plans[0].fallback.domain, "runrepeat.com");
  assert.equal(diagnostics.rejectedUrlCounts.reseller_mirror, 1);
  assert.equal(diagnostics.rejectedUrlCounts.model_mismatch, 1);
  assert.equal(diagnostics.rejectedUrlCounts.retailer_not_independent_review, 1);
});

test("a successful Actor run with an HTTP 500 page uses one bounded fallback URL", async () => {
  const primary = {
    candidateId: "cand_test",
    exactModel: "Nike Pegasus 41",
    query: "Nike Pegasus 41 official specifications",
    title: "Nike Pegasus 41",
    url: "https://www.nike.com/pegasus-41",
    domain: "nike.com",
    sourceType: "manufacturer",
    searchSnippet: "",
  };
  const fallback = {
    ...primary,
    query: "Nike Pegasus 41 independent review",
    title: "Nike Pegasus 41 Review",
    url: "https://runrepeat.com/nike-pegasus-41",
    domain: "runrepeat.com",
    sourceType: "independent",
  };
  const calls = [];
  const diagnostics = crawlDiagnostics();
  const result = await fetchSourcePlan(
    { candidateId: primary.candidateId, exactModel: primary.exactModel, primary, fallback },
    async (source) => {
      calls.push(source.url);
      if (source.url === primary.url) {
        return {
          runId: "run_primary",
          finalStatus: "SUCCEEDED",
          items: [{
            crawl: { httpStatusCode: 500, httpStatusMessage: "Internal Server Error", requestStatus: "handled" },
            metadata: { url: primary.url, title: primary.title },
          }],
        };
      }
      return {
        runId: "run_fallback",
        finalStatus: "SUCCEEDED",
        items: [{
          crawl: { httpStatusCode: 200, httpStatusMessage: "OK", requestStatus: "handled", loadedAt: "2026-10-25T00:00:00.000Z" },
          metadata: { url: fallback.url, title: fallback.title },
          markdown: "Nike Pegasus 41 Review. The cushioning is intended for daily road running.",
        }],
      };
    },
    diagnostics,
  );

  assert.deepEqual(calls, [primary.url, fallback.url]);
  assert.equal(result.source?.finalUrl, fallback.url);
  assert.deepEqual(result.runIds, ["run_primary", "run_fallback"]);
  assert.equal(result.pageFailures, 1);
  assert.equal(diagnostics.rejectedPageCounts.http_status_500, 1);
  assert.equal(diagnostics.parsedPageCount, 1);
});
