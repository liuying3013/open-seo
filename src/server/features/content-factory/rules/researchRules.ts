// Operational constants for ranking-page research (specs/0013 section 6.3).
// These are work-budget knobs, not scoring constants — changing one does not
// require a rule-version bump, because nothing downstream is scored by them.

/**
 * How many ranking pages we read per cluster by default. The spec's range is
 * 5-8; 8 is the ceiling so a caller asking for "as much as allowed" still stops.
 */
export const DEFAULT_PAGES_PER_CLUSTER = 8;

/** Hard ceiling regardless of what a caller asks for. */
export const MAX_PAGES_PER_CLUSTER = 12;

/**
 * Normalized body text stored per page. Long enough for a full buying guide,
 * short enough that a cluster's bodies still fit in one LLM context.
 */
export const RESEARCH_PAGE_BODY_LIMIT = 40_000;

/**
 * A body younger than this is reused instead of refetched (spec section 12:
 * check fetch time and content change before spending again). Ranking pages
 * are edited far more slowly than rankings move.
 */
export const PAGE_FRESHNESS_DAYS = 14;

/**
 * Result types worth opening. Anything else on the SERP (PAA rows, image
 * blocks, related searches) has no body to read.
 */
export const READABLE_RESULT_TYPES = ["organic", "featured_snippet"] as const;
