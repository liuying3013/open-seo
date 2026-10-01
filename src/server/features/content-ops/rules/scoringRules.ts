// Every deterministic constant the content-ops pipeline scores with, in ONE
// place, versioned. decision_log rows record RULE_VERSION so old decisions stay
// interpretable after the constants change — bump the version whenever any
// value here moves.

// v2 (2026-09-05), three changes, all driven by the first real run's data:
//
//  1. facebook + instagram joined the deployable platforms. They were first
//     and second among third-party domains in the stored SERPs (29 and 28 of
//     351 rows) while Medium and LinkedIn scored zero, yet neither could earn
//     a verdict because neither was in the list.
//  2. The SERP-acceptance subscore is normalized against
//     SERP_ACCEPTANCE_FULL_SHARE, so the model's heaviest weight stopped being
//     its weakest signal.
//  3. Verdict thresholds dropped to 65/52/42, because the old lines were
//     unreachable under this weighting.
//
// See SERP_ACCEPTANCE_FULL_SHARE and PLATFORM_VERDICT_THRESHOLDS for the
// numbers behind 2 and 3.
// v3: an ADJACENT taxonomy category (not sold, but its searchers are our
// buyers) deploys as the honest alternative instead of being skipped outright.
export const RULE_VERSION = "content-ops-v3";

// ---------------------------------------------------------------------------
// SERP rank weighting
// ---------------------------------------------------------------------------

/** Positional weight of a SERP result: rank 1 ≈ 1.0, rank 10 ≈ 0.29. */
export function rankWeight(rank: number): number {
  if (rank < 1) return 0;
  return 1 / Math.log2(rank + 1);
}

/** How deep SERP snapshots are fetched and scored. */
export const SERP_DEPTH = 20;

/** SERPs are fetched for at most this many representative keywords per cluster. */
export const MAX_REPRESENTATIVE_KEYWORDS = 3;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const USER_JOBS = [
  "learn",
  "compare",
  "choose",
  "source",
  "troubleshoot",
  "verify",
  "buy",
] as const;
export type UserJob = (typeof USER_JOBS)[number];

export const THIRD_PARTY_PLATFORMS = [
  "medium",
  "youtube",
  "pinterest",
  "linkedin",
  "reddit",
  "quora",
  "pdf",
  // Own-brand channels: posted under the company's own disclosed identity, so
  // they carry no astroturf risk the way reddit/quora do. They earn a verdict
  // the same way as everything else — on what the SERP actually accepts.
  "facebook",
  "instagram",
] as const;
export type ThirdPartyPlatform = (typeof THIRD_PARTY_PLATFORMS)[number];

export const SERP_CONTENT_TYPES = [
  "product",
  "category",
  "commercial_landing",
  "guide",
  "comparison",
  "listicle",
  "forum_thread",
  "qna",
  "video",
  "pdf",
  "brand_home",
  "other",
] as const;
export type SerpContentType = (typeof SERP_CONTENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Business value scoring (0..100)
// ---------------------------------------------------------------------------

// Weights sum to 1. Search demand is deliberately the SMALLEST factor: volume
// never outranks commercial reality.
export const BUSINESS_VALUE_WEIGHTS = {
  supplierReady: 0.25,
  contributionMargin: 0.2,
  purchaseProximity: 0.15,
  marketPriority: 0.15,
  conversionReadiness: 0.1,
  coreRelevance: 0.1,
  searchDemand: 0.05,
} as const;

/** Offer fields → 0..100 subscores. */
export const MARGIN_TIER_SCORE = { high: 100, mid: 60, low: 25 } as const;
export const READINESS_SCORE = { ready: 100, partial: 50, none: 0 } as const;
/** marketPriority 1 (highest) .. 5 (lowest) → 0..100. */
export function marketPriorityScore(priority: number): number {
  const clamped = Math.min(5, Math.max(1, Math.round(priority)));
  return (5 - clamped) * 25;
}

/**
 * Monthly search volume → 0..100 on a log scale. 0 → 0, 10 → ~25, 100 → ~50,
 * 1000 → ~75, 10k+ → 100. B2B queries are low-volume by nature; this keeps
 * tiny-but-lucrative queries in play.
 */
export function searchDemandScore(monthlyVolume: number | null): number {
  if (!monthlyVolume || monthlyVolume <= 0) return 0;
  return Math.min(100, (Math.log10(monthlyVolume) / 4) * 100);
}

// ---------------------------------------------------------------------------
// Platform suitability scoring (0..100 per platform)
// ---------------------------------------------------------------------------

export const PLATFORM_SUITABILITY_WEIGHTS = {
  serpAcceptance: 0.3,
  intentFit: 0.25,
  brandNaturalness: 0.15,
  reuseEfficiency: 0.1,
  accountHealth: 0.1,
  evidenceReadiness: 0.1,
} as const;

/**
 * SERP share at which a platform's acceptance subscore is full marks.
 *
 * Acceptance arrives as a rank-weighted SHARE of page one, and a quarter of
 * page one is already dominance — no third-party platform gets more in
 * practice. Scoring the raw share against subscores that run 0..100 made the
 * heaviest weight in the model the weakest signal in it: on the first real run
 * Medium ranked second overall on clusters where it appeared zero times, out-
 * scoring Facebook at a real 15.3% share. Normalizing against this ceiling is
 * what makes "does Google actually show this platform here" decisive.
 */
export const SERP_ACCEPTANCE_FULL_SHARE = 0.25;

/**
 * Verdict thresholds (score AFTER risk penalty).
 *
 * Lowered from 75/60/45 in content-ops-v2. With neutral agent judgment the
 * model's fixed floor is 17.5 and its realistic ceiling about 53, so the old
 * DEPLOY line needed a platform to own essentially all of page one; the first
 * run put all 45 platform×cluster pairs in SKIP, which is not a signal. At
 * 65/52/42 nothing reaches TEST on neutral inputs alone — the agent has to
 * supply a real basis for brand naturalness and evidence readiness first —
 * and DEPLOY still needs strong acceptance on top of that.
 */
const PLATFORM_VERDICT_THRESHOLDS = { deploy: 65, test: 52, hold: 42 };
export type PlatformVerdict = "DEPLOY" | "TEST" | "HOLD" | "SKIP";

export function verdictForScore(score: number): PlatformVerdict {
  if (score >= PLATFORM_VERDICT_THRESHOLDS.deploy) return "DEPLOY";
  if (score >= PLATFORM_VERDICT_THRESHOLDS.test) return "TEST";
  if (score >= PLATFORM_VERDICT_THRESHOLDS.hold) return "HOLD";
  return "SKIP";
}

/**
 * Static user-job × platform fit (0..1): how well the platform serves someone
 * doing that job, independent of what today's SERP shows.
 */
export const JOB_PLATFORM_FIT: Record<
  UserJob,
  Record<ThirdPartyPlatform, number>
> = {
  learn: {
    medium: 0.8,
    youtube: 0.8,
    pinterest: 0.3,
    linkedin: 0.5,
    reddit: 0.6,
    quora: 0.7,
    pdf: 0.5,
    facebook: 0.3,
    instagram: 0.3,
  },
  compare: {
    medium: 0.7,
    youtube: 0.8,
    pinterest: 0.2,
    linkedin: 0.5,
    reddit: 0.8,
    quora: 0.7,
    pdf: 0.5,
    facebook: 0.2,
    instagram: 0.2,
  },
  choose: {
    medium: 0.6,
    youtube: 0.7,
    pinterest: 0.3,
    linkedin: 0.5,
    reddit: 0.8,
    quora: 0.7,
    pdf: 0.4,
    facebook: 0.2,
    instagram: 0.4,
  },
  source: {
    medium: 0.4,
    youtube: 0.3,
    pinterest: 0.2,
    linkedin: 0.7,
    reddit: 0.5,
    quora: 0.5,
    pdf: 0.6,
    facebook: 0.5,
    instagram: 0.4,
  },
  troubleshoot: {
    medium: 0.6,
    youtube: 0.9,
    pinterest: 0.1,
    linkedin: 0.3,
    reddit: 0.8,
    quora: 0.7,
    pdf: 0.5,
    facebook: 0.3,
    instagram: 0.1,
  },
  verify: {
    medium: 0.5,
    youtube: 0.4,
    pinterest: 0.1,
    linkedin: 0.6,
    reddit: 0.7,
    quora: 0.7,
    pdf: 0.4,
    facebook: 0.5,
    instagram: 0.5,
  },
  buy: {
    medium: 0.3,
    youtube: 0.3,
    pinterest: 0.3,
    linkedin: 0.4,
    reddit: 0.4,
    quora: 0.4,
    pdf: 0.3,
    facebook: 0.3,
    instagram: 0.3,
  },
};

/** How cheaply an evidence pack converts into native content (0..1). */
export const PLATFORM_REUSE_EFFICIENCY: Record<ThirdPartyPlatform, number> = {
  medium: 0.8,
  youtube: 0.4,
  pinterest: 0.6,
  linkedin: 0.8,
  reddit: 0.5,
  quora: 0.6,
  pdf: 0.7,
  // A short post + an image the pack already has.
  facebook: 0.7,
  // Needs real photography of a real install; a text pack does not supply it.
  instagram: 0.5,
};

/**
 * Standing risk penalty (points subtracted). Reddit/Quora carry one because
 * community backlash risk is real even with disclosed identity — and they are
 * ALWAYS human-executed regardless of verdict.
 */
export const PLATFORM_RISK_PENALTY: Record<ThirdPartyPlatform, number> = {
  medium: 0,
  youtube: 0,
  pinterest: 0,
  linkedin: 0,
  reddit: 15,
  quora: 12,
  pdf: 0,
  facebook: 0,
  instagram: 0,
};

/** Default account-health subscore until platform accounts exist (phase 2+). */
export const DEFAULT_ACCOUNT_HEALTH = 50;

// ---------------------------------------------------------------------------
// Intent vector derivation
// ---------------------------------------------------------------------------

export const INTENT_AXES = [
  "informational",
  "commercial",
  "transactional",
  "navigational",
] as const;
export type IntentAxis = (typeof INTENT_AXES)[number];

/**
 * How much each observed SERP content type votes for each intent axis. The
 * intent vector is the rank-weighted, normalized sum of these votes; an LLM
 * pass may then adjust each axis by at most INTENT_LLM_MAX_ADJUSTMENT.
 */
export const CONTENT_TYPE_INTENT_VOTES: Record<
  SerpContentType,
  Partial<Record<IntentAxis, number>>
> = {
  product: { transactional: 0.7, commercial: 0.3 },
  category: { transactional: 0.5, commercial: 0.5 },
  commercial_landing: { transactional: 0.6, commercial: 0.4 },
  guide: { informational: 0.9, commercial: 0.1 },
  comparison: { commercial: 0.8, informational: 0.2 },
  listicle: { commercial: 0.6, informational: 0.4 },
  forum_thread: { informational: 0.6, commercial: 0.4 },
  qna: { informational: 0.8, commercial: 0.2 },
  video: { informational: 0.7, commercial: 0.3 },
  pdf: { informational: 0.9, commercial: 0.1 },
  brand_home: { navigational: 1 },
  other: { informational: 0.5, commercial: 0.5 },
};

// ---------------------------------------------------------------------------
// Daily budgets (runaway-loop guard, per project per UTC day)
// ---------------------------------------------------------------------------
// Operational caps — not scoring constants. Changing a limit does not require
// a RULE_VERSION bump. `null` means uncapped; usage is still counted.

export const BUDGET_KINDS = [
  "serpFetches",
  "llmCalls",
  "briefsGenerated",
  "pageReads",
] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

/** `null` = no daily cap. */
export const DAILY_BUDGET_LIMITS: Record<BudgetKind, number | null> = {
  // Raised from 60 on 2026-09-05 at the operator's request: a batch of 18
  // clusters at 1-3 representative keywords each needs headroom in one day.
  serpFetches: 1000,
  llmCalls: 200,
  briefsGenerated: null,
  // ~8 bodies per cluster (specs/0013 section 6.3) leaves room for roughly 25
  // clusters a day before the guard trips.
  pageReads: 200,
};

export function formatBudgetUsage(used: number, limit: number | null): string {
  return limit === null ? `${used}/unlimited` : `${used}/${limit}`;
}
