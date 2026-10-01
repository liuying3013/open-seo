// Every deterministic constant the opportunity-intel funnel gates and scores
// with, in ONE place, versioned. opportunity_decision_log rows record
// RULE_VERSION so old decisions stay interpretable after the constants change —
// bump the version whenever any value here moves.

export const RULE_VERSION = "opp-v6";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const OPPORTUNITY_TYPES = [
  "a_b2b_gap",
  "b_ecosystem",
  "c_hobby",
  "d_ip_spillover",
  "e_service_automation",
  "other",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

const IP_RISKS = ["green", "yellow", "red", "unknown"] as const;
export type IpRisk = (typeof IP_RISKS)[number];

/** The LLM fine intent taxonomy for discovery keywords (PRD §12). */
export const FINE_INTENTS = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
  "service",
  "supplier",
  "replacement",
  "model",
  "problem",
] as const;
type FineIntent = (typeof FINE_INTENTS)[number];

/** Intents that count toward commercial demand. */
export const COMMERCIAL_INTENTS: readonly FineIntent[] = [
  "commercial",
  "transactional",
  "service",
  "supplier",
  "replacement",
  "model",
];

/** LLM/heuristic page classes for SERP results (the gap pass vocabulary). */
export const PAGE_CLASSES = [
  "supplier",
  "manufacturer",
  "distributor",
  "marketplace",
  "niche_store",
  "brand_home",
  "guide",
  "comparison",
  "forum_thread",
  "qna",
  "video",
  "pdf",
  "directory",
  "social",
  "news",
  "other",
] as const;
export type PageClass = (typeof PAGE_CLASSES)[number];

/** Page classes that represent dedicated commercial supply already ranking. */
export const DEDICATED_SUPPLY_CLASSES: readonly PageClass[] = [
  "supplier",
  "manufacturer",
  "distributor",
  "niche_store",
  "brand_home",
];

// ---------------------------------------------------------------------------
// SERP weighting
// ---------------------------------------------------------------------------

/** Positional weight of a SERP result: rank 1 ≈ 1.0, rank 10 ≈ 0.29. */
export function rankWeight(rank: number): number {
  if (rank < 1) return 0;
  return 1 / Math.log2(rank + 1);
}

/** How deep SERP snapshots are fetched and scored. */
export const SERP_DEPTH = 20;

/** SERPs are fetched for at most this many keywords per opportunity. */
export const SERP_KEYWORDS_PER_OPPORTUNITY = 5;

/**
 * How much each page class fails to satisfy commercial supply intent (0..1).
 * 1 = pure gap evidence (a forum ranking for a buying query), 0 = the intent
 * is already served by a dedicated supplier.
 */
export const GAP_PAGE_CLASS_WEIGHTS: Record<PageClass, number> = {
  supplier: 0,
  manufacturer: 0,
  distributor: 0.1,
  niche_store: 0.1,
  brand_home: 0.2,
  comparison: 0.3,
  guide: 0.4,
  marketplace: 0.8,
  directory: 0.8,
  video: 0.6,
  news: 0.6,
  forum_thread: 1,
  qna: 0.9,
  pdf: 0.9,
  social: 0.9,
  other: 0.5,
};

// ---------------------------------------------------------------------------
// Opportunity score model (0..100)
// ---------------------------------------------------------------------------

/**
 * The full PRD §21 model — weights sum to 100. V0.1 only has data for a
 * subset of dimensions; absent ones are renormalized away and recorded in the
 * score breakdown (confidence communicates the thinness).
 */
export const SCORE_WEIGHTS = {
  commercialSearchDemand: 10,
  buyerDensity: 10,
  serpSupplyGap: 15,
  competitorWeakness: 10,
  chinaSupplyDepth: 10,
  priceMarginGap: 10,
  buyerFragmentation: 5,
  skuModelDepth: 5,
  repeatPurchase: 5,
  purchaseUrgency: 5,
  serviceAutomationPotential: 5,
  seoScalability: 5,
  logisticsCertification: 3,
  ipLegalRisk: 2,
} as const;
export type ScoreDimension = keyof typeof SCORE_WEIGHTS;

export const IP_RISK_SCORE: Record<IpRisk, number> = {
  green: 100,
  yellow: 60,
  red: 0,
  // Unknown is treated as yellow-ish until the intake pass grades it.
  unknown: 50,
};

/** The bounded LLM business-analysis adjustment (points, applied post-renorm). */
export const LLM_ADJUSTMENT_CLAMP = 8;

/**
 * Monthly commercial volume → 0..100, saturating at 200 (opp-v3, operator
 * calibration 2026-09-01: a real competitor thrives on "helmet cleaning
 * machine"-class keywords at ~70-110 searches/month — in B2B equipment,
 * 200+ monthly commercial searches IS high demand). Log curve:
 * 20 → ~57, 50 → ~74, 100 → ~87, 200+ → 100.
 */
export function volumeScore(monthlyVolume: number): number {
  if (monthlyVolume <= 0) return 0;
  return Math.min(100, (Math.log10(1 + monthlyVolume) / Math.log10(201)) * 100);
}

// ---------------------------------------------------------------------------
// Stage gates
// ---------------------------------------------------------------------------

/**
 * Operator criterion (2026-09-01): the funnel hunts $500+ unit-price
 * opportunities. Seeds whose intake-estimated core product price sits below
 * this floor are parked on the watchlist BEFORE any paid SERP work.
 */
export const MIN_UNIT_PRICE_USD = 500;

export const DEMAND_GATE = {
  /** Demand subscore at/above this proceeds to the (paid) SERP stage. */
  advanceAt: 40,
  /** Below this the opportunity is rejected; between = watchlist. */
  rejectBelow: 15,
} as const;

export const SERP_GATE = {
  /** Total score at/above this is shortlisted (unless IP gate caps it).
   * opp-v2: lowered 70 -> 55 — with only 42/100 weight points of data the
   * renormalized scores cluster in the 40s-50s and 70 was structurally
   * unreachable (first two real batches: 9/9 landed 40-60). */
  shortlistAt: 55,
  /** Below this the opportunity is rejected; between = watchlist. */
  rejectBelow: 40,
} as const;

/**
 * PRD §11: zero search volume is not worthless. A type A/E opportunity whose
 * classified keywords are strongly commercial, with CPC evidence or
 * model/supplier-style queries, gets a demand floor instead of dying on
 * volume alone.
 */
export const ZERO_VOLUME_LANE = {
  types: ["a_b2b_gap", "e_service_automation"] as readonly OpportunityType[],
  minCommercialIntentShare: 0.5,
  /** Any commercial keyword with CPC at/above this counts as CPC evidence. */
  minCpcEvidence: 1.5,
  demandFloor: DEMAND_GATE.advanceAt,
} as const;

// ---------------------------------------------------------------------------
// Confidence (0..100, pure arithmetic — no LLM input)
// ---------------------------------------------------------------------------

export const CONFIDENCE_WEIGHTS = {
  keywordCoverage: 0.25,
  metricsCoverage: 0.2,
  serpCoverage: 0.25,
  recency: 0.15,
  stageDepth: 0.15,
} as const;

/**
 * Real (provider-confirmed) queries at which SEO scalability saturates. Forty
 * genuine long-tail queries around one entity is already a publishable
 * content footprint; counting generated strings instead rewarded padding.
 */
export const REAL_QUERY_BREADTH_TARGET = 40;

/** Keyword count at which keywordCoverage saturates. */
export const CONFIDENCE_KEYWORD_TARGET = 100;
/** Evidence younger than this is fully fresh… */
export const CONFIDENCE_FRESH_DAYS = 30;
/** …and decays linearly to zero at this age. */
export const CONFIDENCE_STALE_DAYS = 180;

// ---------------------------------------------------------------------------
// Batch caps and daily budgets (fail closed; atomically reserved per org)
// ---------------------------------------------------------------------------

/**
 * Operational parallelism — wall-clock only, never affects any decision, so
 * changing these does NOT bump RULE_VERSION. Tuned conservatively for the
 * LLM relay and DataForSEO live endpoints.
 */
export const CONCURRENCY = {
  /** Opportunities processed in parallel within one stage of a scan run. */
  opportunitiesPerStage: 3,
  /** Parallel SERP fetches within one opportunity. */
  serpFetchesPerOpportunity: 4,
  /** Parallel LLM calls within one opportunity (gap/intent batches). */
  llmCallsPerOpportunity: 3,
} as const;

export const RUN_CAPS = {
  /** Opportunities a single scan run may process per stage. */
  opportunitiesPerScan: 20,
  /** Keywords per LLM intent-classification prompt. */
  intentBatchSize: 50,
  /** Metrics younger than this are not refetched. */
  metricsRefetchDays: 30,
  /** SERP snapshots younger than this are not refetched (rerun idempotency). */
  serpRefetchDays: 14,
} as const;

/**
 * Per-organization, per-UTC-day caps by endpoint class. Requests are reserved
 * atomically before each provider call; the separate cost ledger records spend.
 * Units are API requests (keyword metrics batches up to ~700 keywords).
 */
export const DAILY_BUDGET_LIMITS = {
  // Runaway guards, not a budget. Sized so batch work never trips them —
  // roughly 500 opportunities' worth of lookups and 400 opportunities' worth
  // of SERP per UTC day — while a looping bug still stops at about $22 of
  // DataForSEO spend instead of draining the account. At measured prices:
  // 600 lookups ≈ $9.60, 2000 SERPs ≈ $12.
  keywordLookups: 600,
  serpFetches: 2000,
  llmCalls: 5000,
} as const;
/** Cost-event endpoints → which daily budget they consume. */
export const ENDPOINT_BUDGET_KIND = {
  labs_keyword_metrics: "keywordLookups",
  serp_advanced: "serpFetches",
  llm_intake: "llmCalls",
  llm_expand: "llmCalls",
  llm_intent: "llmCalls",
  llm_gap: "llmCalls",
  llm_analysis: "llmCalls",
  llm_report: "llmCalls",
} as const;
export type CostEndpoint = keyof typeof ENDPOINT_BUDGET_KIND;

/**
 * Fallback USD cost per request when the provider does not report one.
 * Deliberately rough — the ledger marks provider-reported costs by simply
 * storing them; estimates keep daily totals in the right order of magnitude.
 */
export const ESTIMATED_COST_USD: Partial<Record<CostEndpoint, number>> = {
  // Calibrated against real balance deltas (2026-09-01: 28 metric batches +
  // 138 advanced SERPs ≈ $1.28): keyword_overview ≈ $0.016/batch, SERP
  // organic live advanced (depth 20) ≈ $0.006/request.
  labs_keyword_metrics: 0.016,
  serp_advanced: 0.006,
};
