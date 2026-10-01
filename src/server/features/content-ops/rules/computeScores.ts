import {
  BUSINESS_VALUE_WEIGHTS,
  CONTENT_TYPE_INTENT_VOTES,
  DEFAULT_ACCOUNT_HEALTH,
  INTENT_AXES,
  JOB_PLATFORM_FIT,
  MARGIN_TIER_SCORE,
  PLATFORM_REUSE_EFFICIENCY,
  PLATFORM_RISK_PENALTY,
  PLATFORM_SUITABILITY_WEIGHTS,
  SERP_ACCEPTANCE_FULL_SHARE,
  READINESS_SCORE,
  SERP_CONTENT_TYPES,
  THIRD_PARTY_PLATFORMS,
  marketPriorityScore,
  rankWeight,
  searchDemandScore,
  verdictForScore,
  type IntentAxis,
  type PlatformVerdict,
  type SerpContentType,
  type ThirdPartyPlatform,
  type UserJob,
} from "./scoringRules";

// Pure scoring math over stored SERP rows. No IO, no LLM — everything here is
// reproducible from a decision_log input snapshot plus the rules version.

type ScorableResult = {
  rank: number;
  resultType: string;
  platform: string | null;
  contentType: string | null;
};

const KNOWN_CONTENT_TYPES = new Set<string>(SERP_CONTENT_TYPES);

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/** Best-effort content type for weighting when the LLM pass hasn't run. */
function effectiveContentType(result: ScorableResult): SerpContentType {
  if (result.contentType && KNOWN_CONTENT_TYPES.has(result.contentType)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked above
    return result.contentType as SerpContentType;
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

/**
 * Rank-weighted shares of content formats and third-party platforms across a
 * cluster's SERP rows (all representative keywords/devices merged). Both maps
 * are normalized to 0..1 shares of total positional weight.
 */
export function computeSerpScores(results: ScorableResult[]): {
  formatScores: Record<string, number>;
  platformAcceptance: Record<ThirdPartyPlatform, number>;
} {
  const formatWeights: Partial<Record<SerpContentType, number>> = {};
  const platformWeights: Partial<Record<ThirdPartyPlatform, number>> = {};
  let totalWeight = 0;

  for (const result of results) {
    const weight = rankWeight(result.rank);
    if (weight === 0) continue;
    totalWeight += weight;

    const contentType = effectiveContentType(result);
    formatWeights[contentType] = (formatWeights[contentType] ?? 0) + weight;

    const platform = platformForResult(result);
    if (platform) {
      platformWeights[platform] = (platformWeights[platform] ?? 0) + weight;
    }
  }

  const formatScores: Record<string, number> = {};
  for (const [type, weight] of Object.entries(formatWeights)) {
    formatScores[type] = totalWeight > 0 ? weight / totalWeight : 0;
  }
  const platformAcceptance = Object.fromEntries(
    THIRD_PARTY_PLATFORMS.map((platform) => [
      platform,
      totalWeight > 0 ? (platformWeights[platform] ?? 0) / totalWeight : 0,
    ]),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys enumerated from THIRD_PARTY_PLATFORMS
  ) as Record<ThirdPartyPlatform, number>;

  return { formatScores, platformAcceptance };
}

const DEPLOYABLE_PLATFORMS = new Set<string>(THIRD_PARTY_PLATFORMS);

/** Which of OUR deployable platforms a SERP row counts toward. */
function platformForResult(result: ScorableResult): ThirdPartyPlatform | null {
  if (result.platform) {
    // A row whose platform the domain map already recognized speaks for
    // itself, and must NOT fall through to the video heuristic below: a
    // Facebook, Instagram or TikTok video is not YouTube inventory. Counting
    // it as such is what inflated YouTube's acceptance before content-ops-v2 —
    // on the first real run, 24 of the 38 video rows were not YouTube's.
    // A platform we do not deploy to (tiktok) contributes to nobody.
    return DEPLOYABLE_PLATFORMS.has(result.platform)
      ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked above
        (result.platform as ThirdPartyPlatform)
      : null;
  }
  // Platform unrecognized: a bare video block is YouTube often enough to be
  // the useful default, and a PDF result is our own downloadable format.
  if (result.resultType === "video") return "youtube";
  if (result.contentType === "pdf") return "pdf";
  return null;
}

/**
 * Intent vector from format shares: each observed format votes for intent
 * axes; the result is normalized to sum 1. Empty SERPs default to
 * informational (the safe assumption for content planning).
 */
export function deriveIntentVector(
  formatScores: Record<string, number>,
): Record<IntentAxis, number> {
  const votes: Record<IntentAxis, number> = {
    informational: 0,
    commercial: 0,
    transactional: 0,
    navigational: 0,
  };
  for (const [type, share] of Object.entries(formatScores)) {
    if (!KNOWN_CONTENT_TYPES.has(type)) continue;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- membership checked above
    const typeVotes = CONTENT_TYPE_INTENT_VOTES[type as SerpContentType];
    for (const axis of INTENT_AXES) {
      votes[axis] += share * (typeVotes[axis] ?? 0);
    }
  }
  const total = INTENT_AXES.reduce((sum, axis) => sum + votes[axis], 0);
  if (total === 0) return { ...votes, informational: 1 };
  for (const axis of INTENT_AXES) votes[axis] = votes[axis] / total;
  return votes;
}

export type BusinessValueAgentInputs = {
  /** 0..100: how close to a purchase the searcher is. */
  purchaseProximity: number;
  /** 0..100: landing page / WhatsApp / RFQ path exists and fits. */
  conversionReadiness: number;
  /** 0..100: how central this cluster is to the core business. */
  coreRelevance: number;
};

export function computeBusinessValue(input: {
  offer: {
    marginTier: "high" | "mid" | "low";
    readiness: "ready" | "partial" | "none";
    marketPriority: number;
  } | null;
  agent: BusinessValueAgentInputs;
  /** Summed monthly volume of the cluster's keywords. */
  monthlyVolume: number | null;
}): { score: number; breakdown: Record<string, number> } {
  const subscores: Record<keyof typeof BUSINESS_VALUE_WEIGHTS, number> = {
    supplierReady: input.offer ? READINESS_SCORE[input.offer.readiness] : 0,
    contributionMargin: input.offer
      ? MARGIN_TIER_SCORE[input.offer.marginTier]
      : 0,
    purchaseProximity: clamp(input.agent.purchaseProximity),
    marketPriority: input.offer
      ? marketPriorityScore(input.offer.marketPriority)
      : 0,
    conversionReadiness: clamp(input.agent.conversionReadiness),
    coreRelevance: clamp(input.agent.coreRelevance),
    searchDemand: searchDemandScore(input.monthlyVolume),
  };
  let score = 0;
  for (const [key, weight] of Object.entries(BUSINESS_VALUE_WEIGHTS)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- keys mirror BUSINESS_VALUE_WEIGHTS
    score += subscores[key as keyof typeof BUSINESS_VALUE_WEIGHTS] * weight;
  }
  return {
    score: Math.round(score * 10) / 10,
    breakdown: { ...subscores },
  };
}

export type PlatformPlanEntry = {
  platform: ThirdPartyPlatform;
  verdict: PlatformVerdict;
  score: number;
  subscores: Record<string, number>;
};

export function computePlatformPlan(input: {
  platformAcceptance: Record<ThirdPartyPlatform, number>;
  userJob: UserJob;
  /** 0..100 per platform; defaults to 50 (neutral) when the agent has no view. */
  brandNaturalness?: Partial<Record<ThirdPartyPlatform, number>>;
  /** 0..100: how much original evidence exists to fuel native content. */
  evidenceReadiness?: number;
}): PlatformPlanEntry[] {
  const weights = PLATFORM_SUITABILITY_WEIGHTS;
  return THIRD_PARTY_PLATFORMS.map((platform) => {
    const subscores = {
      // Normalized against SERP_ACCEPTANCE_FULL_SHARE so a share (0..~0.25 in
      // practice) is comparable with the 0..100 subscores it is weighed
      // against; see the constant for what the raw share did to the ranking.
      serpAcceptance:
        Math.min(
          1,
          (input.platformAcceptance[platform] ?? 0) /
            SERP_ACCEPTANCE_FULL_SHARE,
        ) * 100,
      intentFit: JOB_PLATFORM_FIT[input.userJob][platform] * 100,
      brandNaturalness: input.brandNaturalness?.[platform] ?? 50,
      reuseEfficiency: PLATFORM_REUSE_EFFICIENCY[platform] * 100,
      accountHealth: DEFAULT_ACCOUNT_HEALTH,
      evidenceReadiness: input.evidenceReadiness ?? 50,
      riskPenalty: PLATFORM_RISK_PENALTY[platform],
    };
    const raw =
      subscores.serpAcceptance * weights.serpAcceptance +
      subscores.intentFit * weights.intentFit +
      subscores.brandNaturalness * weights.brandNaturalness +
      subscores.reuseEfficiency * weights.reuseEfficiency +
      subscores.accountHealth * weights.accountHealth +
      subscores.evidenceReadiness * weights.evidenceReadiness;
    const score = Math.round((raw - subscores.riskPenalty) * 10) / 10;
    return {
      platform,
      verdict: verdictForScore(score),
      score,
      subscores,
    };
  });
}

/**
 * Deterministic money-site page-type choice from what Google currently ranks
 * plus the intent vector. Order of the rules matters and is part of the
 * rule version.
 */
export function decideMoneySitePageType(input: {
  formatScores: Record<string, number>;
  intentVector: Record<IntentAxis, number>;
}): { pageType: string; reason: string } {
  const share = (type: string) => input.formatScores[type] ?? 0;
  const buyerShare =
    input.intentVector.commercial + input.intentVector.transactional;

  if (share("comparison") >= 0.2) {
    return {
      pageType: "comparison",
      reason: "Comparison pages hold a significant share of the SERP.",
    };
  }
  if (share("product") + share("category") >= 0.35) {
    return {
      pageType: share("product") >= share("category") ? "product" : "category",
      reason: "Google ranks product/category pages for this query set.",
    };
  }
  if (buyerShare >= 0.55 && share("commercial_landing") > 0) {
    return {
      pageType: "commercial_landing",
      reason: "Buyer intent dominates and commercial landings already rank.",
    };
  }
  if (share("listicle") >= 0.25) {
    return {
      pageType: "listicle",
      reason: "List-format content holds a large share of the SERP.",
    };
  }
  if (share("qna") + share("forum_thread") >= 0.3) {
    return {
      pageType: "faq",
      reason: "Q&A/forum content dominates — structured FAQ fits best.",
    };
  }
  if (share("pdf") >= 0.2) {
    return {
      pageType: "technical_reference",
      reason: "Document/spec results rank — a technical reference page fits.",
    };
  }
  return {
    pageType: "guide",
    reason: "Informational content dominates; a guide is the default fit.",
  };
}
