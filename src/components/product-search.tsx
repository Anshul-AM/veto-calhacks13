"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AgentApiError, BuyerAnalysisResponse } from "@/lib/agents/types";
import type {
  ProductCandidate,
  ProductSearchError,
  ProductSearchResponse,
} from "@/lib/products/types";
import type {
  EvidenceRecord,
  InvestigationApiError,
  InvestigationResponse,
  ShortlistedCandidate,
} from "@/lib/investigation/types";

const DEFAULT_QUERY =
  "I need comfortable shoes for daily walking and occasional running, US size 10, preferably black, around $100. Durability matters more than style. I'm open to alternatives.";
const MAX_QUERY_LENGTH = 240;

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ShieldMark() {
  return (
    <svg viewBox="0 0 28 32" fill="none" aria-hidden="true">
      <path d="M14 1.5 26 6v8.8c0 7.1-4.8 12.8-12 15.7C6.8 27.6 2 21.9 2 14.8V6l12-4.5Z" fill="currentColor" />
      <path d="m8.4 15.7 3.5 3.4 7.8-8" stroke="#11130f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatPrice(price: number | null) {
  if (price === null) return "Price unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price);
}

function formatCount(count: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

function ProductCard({ product, hasHardLimit }: { product: ProductCandidate; hasHardLimit: boolean }) {
  const outsideHardLimit = hasHardLimit && product.price !== null && !product.withinBudget;
  return (
    <article className={`product-card ${outsideHardLimit ? "product-card-over" : ""}`}>
      <div className="product-image-wrap">
        {product.imageUrl ? (
          // Product image hosts vary by result, so a static Next Image allowlist is not practical.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt="" className="product-image" loading="lazy" />
        ) : (
          <div className="image-fallback" aria-hidden="true"><SearchIcon /></div>
        )}
        <span className={`budget-badge ${outsideHardLimit ? "budget-over" : "candidate-badge"}`}>
          {outsideHardLimit ? "Outside hard limit" : "Discovered candidate"}
        </span>
      </div>
      <div className="product-content">
        <p className="merchant">{product.merchant ?? "Merchant not provided"}</p>
        <h3>{product.title}</h3>
        <div className="price-row">
          <strong>{formatPrice(product.price)}</strong>
          {product.rating !== null && (
            <span className="rating" aria-label={`${product.rating} out of 5 stars`}>
              <span aria-hidden="true">★</span> {product.rating.toFixed(1)}
              {product.ratingCount !== null && <small> ({formatCount(product.ratingCount)})</small>}
            </span>
          )}
        </div>
        {product.sourceUrl ? (
          <a href={product.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
            View discovery link <span className="text-arrow" aria-hidden="true">→</span>
          </a>
        ) : (
          <span className="source-unavailable">Source link unavailable</span>
        )}
      </div>
    </article>
  );
}

function LoadingCards() {
  return (
    <div className="results-grid" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="product-card skeleton-card" key={index}>
          <div className="skeleton skeleton-image" />
          <div className="product-content">
            <div className="skeleton skeleton-kicker" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-price" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Retrieval time unavailable" : date.toLocaleString("en-US");
}

function EvidenceSource({ evidence }: { evidence: EvidenceRecord }) {
  return (
    <article className="evidence-source">
      <div className="evidence-source-head">
        <span className={`source-type source-${evidence.sourceType}`}>{evidence.sourceType}</span>
        <time dateTime={evidence.retrievalTimestamp}>{formatTimestamp(evidence.retrievalTimestamp)}</time>
      </div>
      <h4>{evidence.sourceTitle}</h4>
      <a href={evidence.originalUrl} target="_blank" rel="noopener noreferrer">
        {evidence.domain} <span className="text-arrow" aria-hidden="true">→</span>
      </a>
      <blockquote>{evidence.passage}</blockquote>
      <div className="evidence-meta">
        <span>{evidence.evidenceId}</span>
        {evidence.claimsAddressed.length > 0 && (
          <span>Targets: {evidence.claimsAddressed.join(" · ")}</span>
        )}
      </div>
    </article>
  );
}

function CandidateEvidence({
  candidate,
  investigation,
}: {
  candidate: ShortlistedCandidate;
  investigation: InvestigationResponse;
}) {
  const evidence = investigation.evidence.filter(
    (entry) => entry.candidateId === candidate.candidateId,
  );
  const analysis = investigation.productAnalyses.find(
    (entry) => entry.candidateId === candidate.candidateId,
  );
  return (
    <article className="evidence-candidate">
      <header className="evidence-candidate-head">
        <div>
          <span>Provisional shortlist</span>
          <h3>{candidate.exactModel}</h3>
          <p>{candidate.shortlistReasons.join(" ")}</p>
        </div>
        <strong>{formatPrice(candidate.price)}</strong>
      </header>

      {candidate.unverifiedAttributes.length > 0 && (
        <div className="unknown-strip">
          <strong>Buyer requirement—not verified for this product</strong>
          <span>{candidate.unverifiedAttributes.join(" · ")}</span>
        </div>
      )}

      {analysis ? (
        <div className="claim-list">
          {analysis.claims.length > 0 ? analysis.claims.map((claim, index) => (
            <div className="claim-row" key={`${claim.claim}-${index}`}>
              <span className={`claim-status status-${claim.status}`}>{claim.status}</span>
              <div>
                <h4>{claim.claim}</h4>
                <p>{claim.buyerImplication}</p>
                <small>
                  {[...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds].length > 0
                    ? `Evidence: ${[...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds].join(", ")}`
                    : "No retrieved evidence establishes this claim."}
                </small>
              </div>
            </div>
          )) : <p className="no-analysis">No product claims were established from the retrieved passages.</p>}
          <div className="analysis-limits">
            <div><strong>Missing</strong><p>{analysis.missingInformation.join(" · ") || "None reported."}</p></div>
            <div><strong>Caveats</strong><p>{analysis.importantCaveats.join(" · ") || "None reported."}</p></div>
            <div><strong>Source limits</strong><p>{analysis.sourceQualityLimitations.join(" · ") || "None reported."}</p></div>
          </div>
        </div>
      ) : (
        <p className="no-analysis">
          {evidence.length > 0
            ? "The Evidence Analyst did not complete for this candidate. Retrieved passages remain visible below."
            : "No product claim was assessed because no usable full-page evidence was retrieved for this candidate."}
        </p>
      )}

      <div className="source-list">
        <h4>Retrieved source passages</h4>
        {evidence.length > 0 ? evidence.map((entry) => (
          <EvidenceSource evidence={entry} key={entry.evidenceId} />
        )) : <p className="no-analysis">No usable public source passage was retrieved for this candidate.</p>}
      </div>
    </article>
  );
}

function VerdictSummary({ investigation }: { investigation: InvestigationResponse }) {
  const bestMatch = investigation.shortlist.find(
    (candidate) => candidate.candidateId === investigation.verdict.bestMatchCandidateId,
  );
  const challenged = investigation.verdict.whatVetoChallenged.length > 0
    ? investigation.verdict.whatVetoChallenged
    : investigation.challenger?.findings.map((finding) => finding.concern) ?? [];

  return (
    <section className={`verdict-card verdict-${investigation.verdict.decision}`} aria-labelledby="verdict-title">
      <div className="verdict-kicker">
        <span>{bestMatch ? "Best match" : "VETO verdict"}</span>
        <small>{investigation.verdict.decision.replaceAll("_", " ")}</small>
      </div>
      <h2 id="verdict-title">{bestMatch?.exactModel ?? investigation.verdict.headline}</h2>
      {bestMatch && <h3>{investigation.verdict.headline}</h3>}
      <p className="verdict-rationale">{investigation.verdict.rationale}</p>

      <div className="verdict-section">
        <strong>Worth considering</strong>
        {investigation.verdict.worthConsidering.length > 0 ? (
          <div className="considering-grid">
            {investigation.verdict.worthConsidering.map((item) => {
              const candidate = investigation.shortlist.find((entry) => entry.candidateId === item.candidateId);
              return (
                <article key={item.candidateId}>
                  <h4>{candidate?.exactModel ?? "Shortlisted option"}</h4>
                  <p>{item.reason}</p>
                  {item.conditions.length > 0 && <small>Confirm: {item.conditions.join(" · ")}</small>}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="verdict-empty">No candidate is promoted until VETO has enough model-specific evidence.</p>
        )}
      </div>

      <div className="verdict-columns">
        <div>
          <strong>What VETO challenged</strong>
          {challenged.length > 0 ? <ul>{challenged.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No validated challenge was produced.</p>}
        </div>
        <div>
          <strong>What remains unverified</strong>
          {investigation.verdict.remainsUnverified.length > 0 ? (
            <ul>{[...new Set(investigation.verdict.remainsUnverified)].map((item) => (
  <li key={item}>{item}</li>
))}</ul>
          ) : <p>No additional uncertainty was reported.</p>}
        </div>
      </div>

      {investigation.evidence.length > 0 && (
        <div className="verdict-sources">
          <strong>Sources used</strong>
          {[...new Map(investigation.evidence.map((entry) => [entry.originalUrl, entry])).values()].map((source) => (
            <a href={source.originalUrl} target="_blank" rel="noopener noreferrer" key={source.originalUrl}>
              <span>{source.sourceType}</span>{source.sourceTitle} <span className="text-arrow" aria-hidden="true">→</span>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceInvestigation({ investigation }: { investigation: InvestigationResponse }) {
  const stateCopy = {
    COMPLETED: {
      label: "Evidence complete",
      title: "Source-backed evidence was retrieved.",
      detail: `VETO retrieved ${investigation.meta.pagesRetrieved} usable public pages and completed evidence analysis for both provisional models.`,
    },
    PARTIAL_EVIDENCE: {
      label: "Partial evidence",
      title: "Useful evidence was found, but coverage is incomplete.",
      detail: `VETO retained ${investigation.evidence.length} relevant passage${investigation.evidence.length === 1 ? "" : "s"} from ${investigation.meta.pagesRetrieved} usable public page${investigation.meta.pagesRetrieved === 1 ? "" : "s"}. Missing source types and unknowns remain explicit.`,
    },
    NO_EVIDENCE: {
      label: "No evidence",
      title: "No usable full-page evidence was retrieved.",
      detail: "The shortlist is still provisional. Search-result context may be shown below, but it does not verify product claims and the Evidence Analyst did not run.",
    },
    RETRIEVAL_FAILED: {
      label: "Retrieval failed",
      title: "Public evidence could not be retrieved.",
      detail: "No product claim was marked supported or contradicted. The diagnostic summary below identifies the failed stage without exposing source text or credentials.",
    },
  }[investigation.status];

  return (
    <section className={`evidence-report evidence-state-${investigation.status.toLowerCase()}`} aria-labelledby="evidence-title">
      <details className="evidence-details">
        <summary>How this investigation works · sources and diagnostics</summary>
        <div className="evidence-details-body">
      <div className="evidence-report-heading">
        <div>
          <span className="section-label">Evidence investigation</span>
          <h2 id="evidence-title">{stateCopy.title}</h2>
        </div>
        <span className={`evidence-status-badge evidence-status-${investigation.status.toLowerCase()}`}>
          {stateCopy.label}
        </span>
      </div>
      <p className="evidence-intro">
        {stateCopy.detail}{" "}
        {investigation.meta.finalJudgeExecuted
          ? "The Challenger and Final Judge completed using only the retained passages."
          : investigation.meta.challengerExecuted
            ? "The Challenger completed, but a validated final judgment was unavailable."
            : "No model claim was advanced beyond the evidence stages shown below."}
      </p>

      <div className="evidence-candidates">
        {investigation.shortlist.map((candidate) => (
          <CandidateEvidence candidate={candidate} investigation={investigation} key={candidate.candidateId} />
        ))}
      </div>

      {investigation.searchContexts.length > 0 && (
        <div className="search-contexts">
          <div>
            <strong>Search-result context</strong>
            <p>Lower-confidence discovery context only. These snippets are not crawled page evidence and were not supplied to the Evidence Analyst.</p>
          </div>
          <div className="search-context-grid">
            {investigation.searchContexts.map((context) => (
              <article key={`${context.candidateId}-${context.url}`}>
                <span>{context.sourceType} · unverified snippet</span>
                <h4>{context.title}</h4>
                {context.snippet && <p>{context.snippet}</p>}
                <a href={context.url} target="_blank" rel="noopener noreferrer">
                  {context.domain} <span className="text-arrow" aria-hidden="true">→</span>
                </a>
              </article>
            ))}
          </div>
        </div>
      )}

      {investigation.issues.length > 0 && (
        <div className="retrieval-issues">
            <strong>Coverage notes</strong>
          <ul>
            {investigation.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}><span>{issue.stage}</span>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="diagnostic-summary" aria-label="Sanitized investigation diagnostics">
        <strong>Retrieval diagnostics</strong>
        <div>
          <span>Search</span>
          <p>
            {investigation.diagnostics.search.finalStatus ?? "not completed"} · {investigation.diagnostics.search.datasetItemCount} dataset rows · {investigation.diagnostics.search.errorRowCount} error rows · {investigation.diagnostics.search.organicResultCount} organic results · {investigation.diagnostics.search.candidateUrlCount} candidate URLs · {investigation.diagnostics.search.selectedSourceCount} sources selected
          </p>
        </div>
        <div>
          <span>Page checks</span>
          <p>
            {investigation.diagnostics.crawl.finalStatus ?? "not run"} · {investigation.diagnostics.crawl.datasetItemCount} dataset rows · {investigation.diagnostics.crawl.parsedPageCount} usable pages
          </p>
        </div>
        <div>
          <span>Evidence</span>
          <p>
            {investigation.diagnostics.evidence.candidatePassageCount} candidate passages · {investigation.diagnostics.evidence.relevantPassageCount} relevant · {investigation.diagnostics.evidence.retainedPassageCount} retained
          </p>
        </div>
        {(Object.keys(investigation.diagnostics.search.rejectedUrlCounts).length > 0 ||
          Object.keys(investigation.diagnostics.crawl.rejectedPageCounts).length > 0) && (
          <small>
            Sanitized rejection categories: {[
              ...Object.entries(investigation.diagnostics.search.rejectedUrlCounts),
              ...Object.entries(investigation.diagnostics.crawl.rejectedPageCounts),
            ].map(([reason, count]) => `${reason} (${count})`).join(" · ")}
          </small>
        )}
      </div>
      <div className="evidence-run-meta">
        <span>{investigation.meta.cacheHit ? "Cached investigation" : "Fresh investigation"}</span>
        <span>Evidence retrieved {formatTimestamp(investigation.meta.retrievalTimestamp)}</span>
        {investigation.meta.googleSearchRunId && <span>Search run {investigation.meta.googleSearchRunId.slice(0, 8)}</span>}
        {investigation.meta.ragWebBrowserRunIds.map((runId) => (
          <span key={runId}>Page run {runId.slice(0, 8)}</span>
        ))}
        {investigation.meta.websiteCrawlerRunId && <span>Crawl run {investigation.meta.websiteCrawlerRunId.slice(0, 8)}</span>}
        <span>Community evidence unavailable</span>
      </div>
        </div>
      </details>
    </section>
  );
}

function BuyerAnalysis({ analysis }: { analysis: BuyerAnalysisResponse }) {
  const { buyerProfile, categoryFramework } = analysis;

  return (
    <section className="analysis-section" aria-labelledby="analysis-title">
      <div className="content-container">
        <details className="analysis-details">
          <summary>How VETO understood your request</summary>
          <div className="analysis-details-body">
        <div className="analysis-heading">
          <div>
            <span className="section-label">Your decision brief</span>
            <h2 id="analysis-title">What matters—and what needs checking.</h2>
          </div>
          <span className="framework-badge">Framework, not findings</span>
        </div>

        <div className="analysis-grid">
          <article className="analysis-panel buyer-panel">
            <header>
              <span className="agent-index">Needs</span>
              <div><h3>Your priorities</h3><p>A structured reading of your request.</p></div>
            </header>
            <div className="analysis-summary">
              <span>{buyerProfile.productCategory}</span>
              <p>{buyerProfile.requestSummary}</p>
            </div>

            <div className="analysis-block">
              <h4>Intended use</h4>
              <div className="analysis-chips">
                {buyerProfile.intendedUses.map((item) => <span key={item}>{item}</span>)}
              </div>
            </div>

            <div className="analysis-block">
              <h4>Priorities</h4>
              <ul className="priority-list">
                {buyerProfile.priorities.map((priority) => (
                  <li key={`${priority.name}-${priority.importance}`}>
                    <span className={`priority-dot ${priority.importance}`} />
                    <div><strong>{priority.name}</strong><p>{priority.rationale}</p></div>
                    <small>{priority.importance}</small>
                  </li>
                ))}
              </ul>
            </div>

            {(buyerProfile.hardConstraints.length > 0 || buyerProfile.softPreferences.length > 0) && (
              <div className="constraint-columns">
                <div><h4>Hard constraints</h4>{buyerProfile.hardConstraints.length > 0 ? (
                  <ul>{buyerProfile.hardConstraints.map((item) => <li key={`${item.attribute}-${item.value}`}><strong>{item.attribute}</strong><span>{item.value}</span></li>)}</ul>
                ) : <p>None stated.</p>}</div>
                <div><h4>Flexible preferences</h4>{buyerProfile.softPreferences.length > 0 ? (
                  <ul>{buyerProfile.softPreferences.map((item) => <li key={`${item.attribute}-${item.value}`}><strong>{item.attribute}</strong><span>{item.value}</span></li>)}</ul>
                ) : <p>None stated.</p>}</div>
              </div>
            )}

            {buyerProfile.ambiguities.length > 0 && (
              <div className="analysis-note"><strong>Still unclear</strong><p>{buyerProfile.ambiguities.join(" · ")}</p></div>
            )}
          </article>

          <article className="analysis-panel expert-panel">
            <header>
              <span className="agent-index">Criteria</span>
              <div><h3>What good looks like</h3><p>The category-specific checks used during investigation.</p></div>
            </header>
            <div className="analysis-summary">
              <span>{categoryFramework.category}</span>
              <p>{categoryFramework.categorySummary}</p>
            </div>

            <div className="analysis-block">
              <h4>Evaluation framework</h4>
              <ol className="criteria-list">
                {categoryFramework.evaluationCriteria.map((criterion, index) => (
                  <li key={criterion.name}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><strong>{criterion.name}</strong><p>{criterion.whyItMatters}</p></div>
                    <small>{criterion.priority}</small>
                  </li>
                ))}
              </ol>
            </div>

            <div className="analysis-block research-targets">
              <h4>Claims to verify later</h4>
              <ul>{categoryFramework.claimsToVerify.map((claim) => <li key={claim}>{claim}</li>)}</ul>
            </div>

            {categoryFramework.commonFailureModes.length > 0 && (
              <div className="analysis-note"><strong>Failure modes to investigate</strong><p>{categoryFramework.commonFailureModes.map((item) => item.failure).join(" · ")}</p></div>
            )}
          </article>
        </div>

        <div className="analysis-disclaimer">
          <ShieldMark />
          <p><strong>These outputs contain no product evidence.</strong> They organize the buyer&apos;s request and define what the separate research stage should check. They do not verify claims, reviews, durability, fit, or product quality.</p>
          <span>{analysis.meta.cached ? "Reused decision brief" : "Fresh decision brief"}</span>
        </div>
          </div>
        </details>
      </div>
    </section>
  );
}

export function ProductSearch() {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [analysis, setAnalysis] = useState<BuyerAnalysisResponse | null>(null);
  const [result, setResult] = useState<ProductSearchResponse | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationResponse | null>(null);
  const [investigationError, setInvestigationError] = useState<string | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "interpreting" | "discovering">("idle");
  const loading = phase !== "idle";
  const busy = loading || investigating;
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = requestRef.current;
    if (!textarea) return;
    const fitRequest = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    fitRequest();
    window.addEventListener("resize", fitRequest);
    return () => window.removeEventListener("resize", fitRequest);
  }, [query]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setError("Describe what you want to find.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("interpreting");
    setError(null);
    setAnalysis(null);
    setResult(null);
    setInvestigation(null);
    setInvestigationError(null);

    try {
      const analysisResponse = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuery }),
        signal: controller.signal,
      });
      const analysisPayload = (await analysisResponse.json()) as BuyerAnalysisResponse | AgentApiError;
      if (!analysisResponse.ok || "error" in analysisPayload) {
        throw new Error(
          "error" in analysisPayload ? analysisPayload.error : "Buyer interpretation failed.",
        );
      }
      setAnalysis(analysisPayload);
      setPhase("discovering");

      const productsResponse = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmedQuery,
          searchQuery: analysisPayload.buyerProfile.discoveryQuery,
        }),
        signal: controller.signal,
      });
      const productsPayload = (await productsResponse.json()) as
        | ProductSearchResponse
        | ProductSearchError;
      if (!productsResponse.ok || "error" in productsPayload) {
        throw new Error(
          "error" in productsPayload ? productsPayload.error : "Product discovery failed.",
        );
      }
      setResult(productsPayload);
      setPhase("idle");
      setInvestigating(true);

      try {
        const investigationResponse = await fetch("/api/investigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: trimmedQuery,
            buyerProfile: analysisPayload.buyerProfile,
            categoryFramework: analysisPayload.categoryFramework,
            products: productsPayload.products,
          }),
          signal: controller.signal,
        });
        const investigationPayload = (await investigationResponse.json()) as
          | InvestigationResponse
          | InvestigationApiError;
        if (!investigationResponse.ok || "error" in investigationPayload) {
          throw new Error(
            "error" in investigationPayload
              ? investigationPayload.error
              : "Evidence investigation failed.",
          );
        }
        setInvestigation(investigationPayload);
      } catch (investigationRequestError) {
        if (
          investigationRequestError instanceof DOMException &&
          investigationRequestError.name === "AbortError"
        ) return;
        setInvestigationError(
          investigationRequestError instanceof Error
            ? investigationRequestError.message
            : "Evidence investigation failed. No findings were fabricated.",
        );
      }
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Product search failed. Please try again.",
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setPhase("idle");
      setInvestigating(false);
    }
  }

  const hasHardLimit = result?.priceConstraint.kind === "hard";
  const qualifyingCandidates =
    result?.products.filter((product) => !hasHardLimit || product.price === null || product.withinBudget) ?? [];
  const outsideHardLimit =
    result?.products.filter((product) => hasHardLimit && product.price !== null && !product.withinBudget) ?? [];
  const investigationJourneyLabel = investigating
    ? "Investigation pending"
    : investigation?.status === "COMPLETED"
      ? "Evidence complete"
      : investigation?.status === "PARTIAL_EVIDENCE"
        ? "Partial evidence"
        : investigation?.status === "NO_EVIDENCE"
          ? "No evidence retrieved"
          : investigation?.status === "RETRIEVAL_FAILED"
            ? "Retrieval failed"
            : result
              ? "Ready to investigate"
              : phase === "discovering"
                ? "Discovering"
                : "Awaiting candidates";
  const consumerStages = [
    {
      label: "Understanding needs",
      state: analysis ? "done" : phase === "interpreting" ? "active" : "queued",
    },
    {
      label: "Finding options",
      state: result ? "done" : phase === "discovering" ? "active" : "queued",
    },
    {
      label: "Checking evidence",
      state: investigation ? "done" : investigating ? "active" : investigationError ? "failed" : "queued",
    },
    {
      label: "Challenging claims",
      state: investigation?.meta.challengerExecuted
        ? "done"
        : investigation || investigationError
          ? "limited"
          : "queued",
    },
    {
      label: "Preparing verdict",
      state: investigation ? "done" : investigationError ? "limited" : "queued",
    },
  ];

  return (
    <main className="site-shell">
      <nav className="nav-shell content-container" aria-label="Primary navigation">
        <a href="#top" className="brand" aria-label="VETO home">
          <span className="brand-mark"><ShieldMark /></span><span>VETO</span>
        </a>
        <div className="nav-status"><span /> Independent buyer advocacy</div>
      </nav>

      <section className="hero" id="top">
        <div className="content-container hero-inner">
          <div className="eyebrow"><span>Evidence before endorsement</span><i /></div>
          <h1>Before you buy,<br /><em>let VETO investigate.</em></h1>
          <p className="hero-copy">
            Your AI Buyer&apos;s Advocate. Tell us what matters, and VETO will investigate public
            sources, challenge weak claims, and surface what still needs verification before you buy.
          </p>

          <form className="search-panel" onSubmit={handleSubmit} aria-label="Product search">
            <label className="query-field">
              <span>Describe what you need and what matters most</span>
              <div className="query-control">
                <SearchIcon />
                <textarea
                  ref={requestRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxLength={MAX_QUERY_LENGTH}
                  placeholder="Include how you'll use it, preferences, tradeoffs, and any firm constraints"
                  disabled={busy}
                  aria-describedby="search-hint"
                  rows={4}
                />
              </div>
            </label>
            <div className="search-footer">
              <p id="search-hint">
                One request carries your priorities through discovery, evidence checks, challenge,
                and verdict. “No more than $100” is firm; “around $100” remains flexible.
              </p>
              <button type="submit" disabled={busy}>
                {busy ? <><span className="spinner" /> {investigating ? "Investigating" : phase === "interpreting" ? "Understanding" : "Finding options"}</> : <>Investigate my options <span className="text-arrow" aria-hidden="true">→</span></>}
              </button>
            </div>
          </form>

          {(busy || analysis || result) && (
            <ol className="consumer-progress" aria-label="Investigation progress">
              {consumerStages.map((stage) => (
                <li className={`progress-${stage.state}`} key={stage.label}>
                  <span aria-hidden="true" />
                  <div><strong>{stage.label}</strong><small>{stage.state === "done" ? "Done" : stage.state === "active" ? "In progress" : stage.state === "failed" ? "Failed" : stage.state === "limited" ? "Skipped—insufficient evidence" : "Waiting"}</small></div>
                </li>
              ))}
            </ol>
          )}

          <div className="trust-row" aria-label="Current VETO capabilities">
            <span><i>01</i> Your priorities stay in context</span>
            <span><i>02</i> Firm constraints remain firm</span>
            <span><i>03</i> Discovery sources stay visible</span>
          </div>
        </div>
      </section>

      <section className="journey-section" aria-labelledby="journey-title">
        <div className="content-container">
          <div className="journey-intro">
            <div>
              <span className="section-label">The VETO method</span>
              <h2 id="journey-title">From request to defensible decision.</h2>
            </div>
            <p>One request moves from your priorities to product discovery, public evidence, a skeptical challenge, and a cautious verdict.</p>
          </div>
          <ol className="journey-grid">
            <li className="journey-card current">
              <span className="journey-number">01</span>
              <div><strong>Understand</strong><p>Record the request as written and extract only narrow, explicit price language.</p></div>
              <small>{analysis ? "Interpreted" : phase === "interpreting" ? "Interpreting" : "Basic capture"}</small>
            </li>
            <li className="journey-card current">
              <span className="journey-number">02</span>
              <div><strong>Investigate</strong><p>Shortlist two models and retrieve bounded manufacturer and independent source passages.</p></div>
              <small>{investigationJourneyLabel}</small>
            </li>
            <li className={`journey-card ${investigation ? "current" : "upcoming"}`}>
              <span className="journey-number">03</span>
              <div><strong>Challenge</strong><p>Test product claims against independent evidence and unresolved gaps.</p></div>
              <small>{investigation?.meta.challengerExecuted ? "Completed" : investigation ? "Not enough evidence" : "Runs automatically"}</small>
            </li>
            <li className={`journey-card ${investigation ? "current" : "upcoming"}`}>
              <span className="journey-number">04</span>
              <div><strong>Recommend</strong><p>Explain the fit, surface alternatives, or issue a justified veto.</p></div>
              <small>{investigation ? "Verdict ready" : "Runs automatically"}</small>
            </li>
          </ol>
        </div>
      </section>

      {analysis && <BuyerAnalysis analysis={analysis} />}

      {(loading || error || result) && (
      <section className="results-section" aria-live="polite" aria-busy={busy}>
        <div className="content-container">
        {phase === "interpreting" && (
          <div className="agent-loading state-block">
            <span className="spinner agent-spinner" />
            <div><span className="section-label">Understanding needs</span><h2>Structuring your decision.</h2><p>VETO is separating firm constraints from flexible preferences and deciding what evidence matters.</p></div>
          </div>
        )}

        {phase === "discovering" && (
          <div className="state-block loading-state">
            <div className="results-heading">
              <div><span className="section-label">Candidate discovery</span><h2>Finding products to investigate…</h2></div>
              <p>This discovers candidates only. No evidence review or recommendation is being generated.</p>
            </div>
            <LoadingCards />
          </div>
        )}

        {error && !loading && (
          <div className="message-card error-card" role="alert">
            <span className="message-icon">!</span>
            <div><strong>We couldn&apos;t complete that search.</strong><p>{error}</p></div>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button>
          </div>
        )}

        {result && !loading && (
          <div className="state-block">
            <div className="results-heading">
              <div>
                <span className="section-label">Discovered candidates</span>
                <h2>
                  {qualifyingCandidates.length > 0
                    ? `${qualifyingCandidates.length} candidate${qualifyingCandidates.length === 1 ? "" : "s"} to investigate`
                    : "No candidates meet the hard limit"}
                </h2>
              </div>
              <p>
                {result.priceConstraint.kind === "hard" && result.priceConstraint.amount !== null
                  ? `Hard price ceiling: ${formatPrice(result.priceConstraint.amount)}`
                  : result.priceConstraint.kind === "soft" && result.priceConstraint.amount !== null
                    ? `Soft price target: around ${formatPrice(result.priceConstraint.amount)} — not a veto rule`
                    : "No explicit price constraint detected"}
              </p>
            </div>

            {result.products.length === 0 ? (
              <div className="empty-state">
                <div><SearchIcon /></div>
                <h3>No candidates surfaced</h3>
                <p>Try broader wording or describe the category in a different way.</p>
              </div>
            ) : (
              <>
                {qualifyingCandidates.length > 0 && (
                  <div className="results-grid">
                    {qualifyingCandidates.map((product) => (
                      <ProductCard key={product.productId} product={product} hasHardLimit={hasHardLimit} />
                    ))}
                  </div>
                )}
                {outsideHardLimit.length > 0 && (
                  <div className="over-budget-section">
                    <div className="subsection-heading">
                      <h3>Outside your explicit hard limit</h3>
                      <p>Shown only for transparency. These candidates are excluded by your firm price ceiling.</p>
                    </div>
                    <div className="results-grid">
                      {outsideHardLimit.map((product) => (
                        <ProductCard key={product.productId} product={product} hasHardLimit={hasHardLimit} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="disclosure">
              <ShieldMark />
              <p>
                <strong>Discovery, not verification.</strong> These are candidates from Google
                Shopping data, which may include promoted or sponsored listings. They are not
                verified VETO recommendations. Price, availability, sizing,
                color, review content, suitability, merchant identity, and checkout destination
                must be confirmed at the source.
              </p>
              <span>
                {result.meta.cached ? "Cached discovery" : "Fresh discovery"} · Run {result.meta.actorRunId.slice(0, 8)} · {new Date(result.meta.sourceTimestamp).toLocaleString("en-US")}
              </span>
            </div>

            {investigating && (
              <div className="investigation-progress" role="status" aria-live="polite">
                <span className="spinner agent-spinner" />
                <div>
                  <strong>Investigation request in progress</strong>
                  <p>VETO is checking selected sources, challenging weak claims, and preparing a cautious verdict. Results appear together when the investigation finishes.</p>
                </div>
              </div>
            )}

            {investigationError && !investigating && (
              <div className="message-card error-card" role="alert">
                <span className="message-icon">!</span>
                <div><strong>The investigation did not complete.</strong><p>{investigationError}</p></div>
                <button type="button" onClick={() => setInvestigationError(null)} aria-label="Dismiss investigation error">×</button>
              </div>
            )}

            {investigation && !investigating && (
              <>
                <VerdictSummary investigation={investigation} />
                <EvidenceInvestigation investigation={investigation} />
              </>
            )}
          </div>
        )}
        </div>
      </section>
      )}

      <footer className="content-container">
        <a href="#top" className="brand"><span className="brand-mark"><ShieldMark /></span><span>VETO</span></a>
        <p>Independent investigation for decisions you can defend.</p>
        <span>Cal Hacks 13.0 · 2026</span>
      </footer>
    </main>
  );
}
