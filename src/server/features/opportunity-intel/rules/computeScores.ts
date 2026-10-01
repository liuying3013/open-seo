import type { KeywordRole } from "./keywordTemplates";
import {
  COMMERCIAL_INTENTS,
  CONFIDENCE_FRESH_DAYS,
  CONFIDENCE_KEYWORD_TARGET,
  CONFIDENCE_STALE_DAYS,
  CONFIDENCE_WEIGHTS,
  DEDICATED_SUPPLY_CLASSES,
  DEMAND_GATE,
  GAP_PAGE_CLASS_WEIGHTS,
  LLM_ADJUSTMENT_CLAMP,
  PAGE_CLASSES,
  REAL_QUERY_BREADTH_TARGET,
  SCORE_WEIGHTS,
  SERP_GATE,
  ZERO_VOLUME_LANE,
  rankWeight,
  volumeScore,
  type IpRisk,
  type OpportunityType,
  type PageClass,
  type ScoreDimension,
} from "./scoringRules";

// Pure scoring math over stored rows. No IO, no LLM — everything here is
// reproducible from an opportunity_decision_log input snapshot plus the rules
// version.

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const clamp100 = (value: number) => Math.min(100, Math.max(0, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

const COMMERCIAL_INTENT_SET = new Set<string>(COMMERCIAL_INTENTS);
const KNOWN_PAGE_CLASSES = new Set<string>(PAGE_CLASSES);
const DEDICATED_SET = new Set<PageClass>(DEDICATED_SUPPLY_CLASSES);

// ---------------------------------------------------------------------------
// Commercial search demand
// ---------------------------------------------------------------------------

export type ScorableOpportunityKeyword = {
  role: KeywordRole;
  /** LLM fine intent, null while unclassified. */
  intent: string | null;
  searchVolume: number | null;
  cpc: number | null;
};

export function computeDemandScore(input: {
  type: OpportunityType;
  keywords: ScorableOpportunityKeyword[];
}): {
  score: number;
  laneApplied: boolean;
  breakdown: Record<string, number | boolean>;
} {
  // Buyer-role queries describe the END market of our business customer
  // ("pottery classes near me" when we sell pug mills). They are evidence the
  // customer's own market exists, and they feed the report — but counting
  // their volume as OUR demand inflates the score by an order of magnitude,
  // so demand is measured on the queries our actual buyers type.
  const ourMarket = input.keywords.filter((k) => k.role !== "buyer");
  const classified = ourMarket.filter((k) => k.intent !== null);
  const commercial = classified.filter((k) =>
    COMMERCIAL_INTENT_SET.has(k.intent ?? ""),
  );
  const commercialVolume = commercial.reduce(
    (sum, k) => sum + (k.searchVolume ?? 0),
    0,
  );
  const commercialIntentShare =
    classified.length > 0 ? commercial.length / classified.length : 0;
  const maxCommercialCpc = commercial.reduce(
    (max, k) => Math.max(max, k.cpc ?? 0),
    0,
  );
  const demandVolumeScore = volumeScore(commercialVolume);

  const raw = 0.6 * demandVolumeScore + 0.4 * (commercialIntentShare * 100);

  // PRD §11 zero-volume lane: strong commercial intent + CPC evidence or
  // model/supplier-style queries floors the demand score for type A/E.
  const hasHighTicketSignal = ourMarket.some(
    (k) => k.role === "model" || k.role === "supplier",
  );
  const laneApplied =
    ZERO_VOLUME_LANE.types.includes(input.type) &&
    commercialIntentShare >= ZERO_VOLUME_LANE.minCommercialIntentShare &&
    (maxCommercialCpc >= ZERO_VOLUME_LANE.minCpcEvidence ||
      hasHighTicketSignal) &&
    raw < ZERO_VOLUME_LANE.demandFloor;

  const score = round1(laneApplied ? ZERO_VOLUME_LANE.demandFloor : raw);
  return {
    score,
    laneApplied,
    breakdown: {
      keywordCount: input.keywords.length,
      buyerRoleExcluded: input.keywords.length - ourMarket.length,
      classifiedCount: classified.length,
      commercialCount: commercial.length,
      commercialVolume,
      volumeScore: round1(demandVolumeScore),
      commercialIntentShare: round1(commercialIntentShare * 100) / 100,
      maxCommercialCpc,
      hasHighTicketSignal,
      laneApplied,
    },
  };
}

// ---------------------------------------------------------------------------
// SERP supply gap + competitor weakness
// ---------------------------------------------------------------------------

export type ScorableSerpResult = {
  rank: number;
  resultType: string;
  pageClass: string | null;
};

/** Snapshot-level signals from the LLM gap pass (all 0..1). */
export type GapSignals = {
  intentMismatch: number;
  weakDomainShare: number;
  outdatedShare: number;
};

/** Best-effort page class for weighting when the LLM pass hasn't run. */
function effectivePageClass(result: ScorableSerpResult): PageClass {
  if (result.pageClass && KNOWN_PAGE_CLASSES.has(result.pageClass)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked above
    return result.pageClass as PageClass;
  }
  switch (result.resultType) {
    case "video":
      return "video";
    case "discussion":
      return "forum_thread";
    case "people_also_ask":
      return "qna";
    default:
      return "other";
  }
}

function rankWeightedShare(
  results: ScorableSerpResult[],
  weightOf: (pageClass: PageClass) => number,
): number | null {
  let total = 0;
  let weighted = 0;
  for (const result of results) {
    const weight = rankWeight(result.rank);
    if (weight === 0) continue;
    total += weight;
    weighted += weight * weightOf(effectivePageClass(result));
  }
  return total > 0 ? weighted / total : null;
}

/**
 * 0..100 per-snapshot supply-gap score: rank-weighted "this result does not
 * satisfy commercial supply intent" share, blended with the LLM gap signals
 * when present. An empty SERP scores a neutral 50.
 */
export function computeGapScore(
  results: ScorableSerpResult[],
  signals: GapSignals | null,
): number {
  const classGap =
    rankWeightedShare(results, (cls) => GAP_PAGE_CLASS_WEIGHTS[cls]) ?? 0.5;
  if (!signals) return round1(100 * classGap);
  const signalsScore =
    0.4 * clamp01(signals.intentMismatch) +
    0.3 * clamp01(signals.weakDomainShare) +
    0.3 * clamp01(signals.outdatedShare);
  return round1(100 * (0.55 * classGap + 0.45 * signalsScore));
}

/**
 * 0..100 SERP-only competitor-weakness proxy: how absent/weak the dedicated
 * commercial players are. Without LLM signals the class share alone is used
 * with a conservative haircut (unknown quality is not evidence of weakness).
 */
export function computeCompetitorWeakness(
  results: ScorableSerpResult[],
  signals: GapSignals | null,
): number {
  const dedicatedShare =
    rankWeightedShare(results, (cls) => (DEDICATED_SET.has(cls) ? 1 : 0)) ?? 0;
  if (!signals) return round1(100 * (1 - dedicatedShare) * 0.8);
  return round1(
    100 *
      clamp01(
        0.5 * (1 - dedicatedShare) +
          0.25 * clamp01(signals.weakDomainShare) +
          0.25 * clamp01(signals.outdatedShare),
      ),
  );
}

// ---------------------------------------------------------------------------
// SEO scalability
// ---------------------------------------------------------------------------

const BREADTH_ROLES: readonly KeywordRole[] = [
  "model",
  "problem",
  "comparison",
  "service",
  "supplier",
];

/**
 * 0..100 keyword-breadth proxy: role diversity plus how many queries around
 * this entity REALLY EXIST. opp-v6 counts keywords the provider returned data
 * for, not raw generated count — the old proxy rewarded an LLM that padded
 * its output and punished the quality-first expansion prompt that replaced
 * it (a 122-keyword v1 set with 12 real queries outscored a 76-keyword v2 set
 * with 37).
 */
export function computeSeoScalability(
  keywords: ScorableOpportunityKeyword[],
): number {
  const present = new Set(keywords.map((k) => k.role));
  const diversity =
    BREADTH_ROLES.filter((role) => present.has(role)).length /
    BREADTH_ROLES.length;
  const realQueries = keywords.filter((k) => k.searchVolume !== null).length;
  const countScore = Math.min(1, realQueries / REAL_QUERY_BREADTH_TARGET);
  return round1(100 * (0.6 * diversity + 0.4 * countScore));
}

// ---------------------------------------------------------------------------
// Total score (renormalized) + confidence
// ---------------------------------------------------------------------------

export function computeOpportunityScore(input: {
  dimensions: Partial<Record<ScoreDimension, number>>;
  llmAdjustment?: number;
}): {
  score: number;
  breakdown: {
    dimensions: Partial<Record<ScoreDimension, number>>;
    missingDimensions: ScoreDimension[];
    weightCovered: number;
    rawScore: number;
    llmAdjustment: number;
  };
} {
  let weightCovered = 0;
  let weightedSum = 0;
  const missing: ScoreDimension[] = [];
  for (const [dimension, weight] of Object.entries(SCORE_WEIGHTS)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys mirror SCORE_WEIGHTS
    const value = input.dimensions[dimension as ScoreDimension];
    if (value === undefined) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys mirror SCORE_WEIGHTS
      missing.push(dimension as ScoreDimension);
      continue;
    }
    weightCovered += weight;
    weightedSum += clamp100(value) * weight;
  }
  const rawScore = weightCovered > 0 ? weightedSum / weightCovered : 0;
  const llmAdjustment = Math.max(
    -LLM_ADJUSTMENT_CLAMP,
    Math.min(LLM_ADJUSTMENT_CLAMP, input.llmAdjustment ?? 0),
  );
  return {
    score: round1(clamp100(rawScore + llmAdjustment)),
    breakdown: {
      dimensions: input.dimensions,
      missingDimensions: missing,
      weightCovered,
      rawScore: round1(rawScore),
      llmAdjustment,
    },
  };
}

export function computeConfidence(input: {
  keywordCount: number;
  /** Share of keywords with fetched metrics (0..1). */
  metricsCoveredShare: number;
  serpPlanned: number;
  serpFetched: number;
  /** Age of the newest evidence in days; null = no evidence. */
  evidenceAgeDays: number | null;
  stage: "keyword" | "serp";
}): number {
  const keywordCoverage = Math.min(
    1,
    input.keywordCount / CONFIDENCE_KEYWORD_TARGET,
  );
  const serpCoverage =
    input.serpPlanned > 0
      ? Math.min(1, input.serpFetched / input.serpPlanned)
      : 0;
  const recency =
    input.evidenceAgeDays === null
      ? 0
      : input.evidenceAgeDays <= CONFIDENCE_FRESH_DAYS
        ? 1
        : Math.max(
            0,
            1 -
              (input.evidenceAgeDays - CONFIDENCE_FRESH_DAYS) /
                (CONFIDENCE_STALE_DAYS - CONFIDENCE_FRESH_DAYS),
          );
  const stageDepth = input.stage === "serp" ? 1 : 0.4;
  return round1(
    100 *
      (CONFIDENCE_WEIGHTS.keywordCoverage * keywordCoverage +
        CONFIDENCE_WEIGHTS.metricsCoverage *
          clamp01(input.metricsCoveredShare) +
        CONFIDENCE_WEIGHTS.serpCoverage * serpCoverage +
        CONFIDENCE_WEIGHTS.recency * recency +
        CONFIDENCE_WEIGHTS.stageDepth * stageDepth),
  );
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

type GateOutcome = "advance" | "shortlist" | "watchlist" | "reject";

export function evaluateDemandGate(demandScore: number): {
  outcome: Extract<GateOutcome, "advance" | "watchlist" | "reject">;
  reason: string;
} {
  if (demandScore >= DEMAND_GATE.advanceAt) {
    return {
      outcome: "advance",
      reason: `Demand ${demandScore} >= ${DEMAND_GATE.advanceAt}: proceed to SERP stage.`,
    };
  }
  if (demandScore < DEMAND_GATE.rejectBelow) {
    return {
      outcome: "reject",
      reason: `Demand ${demandScore} < ${DEMAND_GATE.rejectBelow}: no meaningful commercial demand signal.`,
    };
  }
  return {
    outcome: "watchlist",
    reason: `Demand ${demandScore} between thresholds: parked on watchlist.`,
  };
}

export function evaluateSerpGate(input: { score: number; ipRisk: IpRisk }): {
  outcome: Extract<GateOutcome, "shortlist" | "watchlist" | "reject">;
  reason: string;
} {
  if (input.score < SERP_GATE.rejectBelow) {
    return {
      outcome: "reject",
      reason: `Score ${input.score} < ${SERP_GATE.rejectBelow}: rejected after SERP validation.`,
    };
  }
  if (input.score >= SERP_GATE.shortlistAt) {
    if (input.ipRisk === "red") {
      return {
        outcome: "watchlist",
        reason: `Score ${input.score} qualifies but IP risk is red — capped at watchlist (never shortlisted).`,
      };
    }
    return {
      outcome: "shortlist",
      reason: `Score ${input.score} >= ${SERP_GATE.shortlistAt}: shortlisted.`,
    };
  }
  return {
    outcome: "watchlist",
    reason: `Score ${input.score} between thresholds: parked on watchlist.`,
  };
}
