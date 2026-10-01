// Deterministic rules for the knowledge layer (specs/0013 sections 8.4-8.8).
// Pure functions only: every gate here is decided by the service before a write,
// never left to the agent's discretion.

export const KNOWLEDGE_RULE_VERSION = "knowledge-v1";

export const CLAIM_TYPES = [
  "fact",
  "judgment",
  "observation",
  "hypothesis",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const KNOWLEDGE_CATEGORIES = [
  "verified_fact",
  "business_judgment",
  "buyer_question",
  "serp_observation",
  "content_gap",
  "editorial_lesson",
  "known_error",
  "performance_observation",
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const KNOWLEDGE_STATUSES = [
  "candidate",
  "approved",
  "needs_review",
  "superseded",
  "retracted",
] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const SOURCE_QUALITIES = [
  "primary",
  "vendor",
  "competitor",
  "community",
  "derived",
] as const;
export type SourceQuality = (typeof SOURCE_QUALITIES)[number];

/**
 * Statement normalization for the dedupe unique index. Same conservative
 * approach as `normalizeKeyword`: case, unicode form, punctuation and spacing
 * only. No stemming — "supports 4x8 panels" and "support 4x8 panel" are close
 * enough that a human should merge them deliberately, not silently.
 */
export function normalizeStatement(statement: string): string {
  return statement
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * How long a claim stays trustworthy before someone should look again. Per
 * category rather than one global TTL: a fire-test rating and a price band go
 * stale at very different speeds (spec section 8.7).
 */
const RECHECK_DAYS_BY_CATEGORY: Record<KnowledgeCategory, number> = {
  verified_fact: 365,
  business_judgment: 180,
  buyer_question: 365,
  // A SERP observation is a snapshot of one moment and ages fastest.
  serp_observation: 60,
  content_gap: 90,
  editorial_lesson: 730,
  known_error: 730,
  performance_observation: 90,
};

export function recheckAfterFor(
  category: KnowledgeCategory,
  fromIso: string,
): string {
  const days = RECHECK_DAYS_BY_CATEGORY[category];
  return new Date(
    new Date(fromIso).getTime() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

type SourceFlags = {
  isIndependent: boolean;
  isOwnContent: boolean;
};

/**
 * Gate (c): how many genuinely independent sources back a claim. Syndicated
 * and mutually-rewritten pages are marked `isIndependent: false` and count as
 * one between them, so five copies of one press release stay one source.
 */
export function independentSourceCount(sources: SourceFlags[]): number {
  const independent = sources.filter((s) => s.isIndependent).length;
  const dependent = sources.length - independent;
  return independent + (dependent > 0 ? 1 : 0);
}

/**
 * Gate (b), the self-citation ban (spec section 8.6): a `fact` whose every
 * source is our own published content cannot be approved. The model would be
 * citing itself, one generation removed.
 *
 * Judgments, observations and hypotheses are exempt: "our guide takes this
 * angle" is legitimately sourced to our own page.
 */
export function blocksApprovalAsSelfCitation(input: {
  claimType: ClaimType;
  sources: SourceFlags[];
}): boolean {
  if (input.claimType !== "fact") return false;
  if (input.sources.length === 0) return true;
  return input.sources.every((source) => source.isOwnContent);
}

/**
 * Gate (a): what may enter a writing context (spec sections 8.4 and 8.8).
 * Only settled, publishable claims — candidates and disputed entries are for
 * review, and internal-scope claims (supplier cost, margin, customer identity)
 * never reach a draft at all.
 */
export function isUsableInWriting(entry: {
  status: KnowledgeStatus;
  scope: "public" | "internal";
}): boolean {
  return entry.status === "approved" && entry.scope === "public";
}

/** Whether a claim is past its recheck date and should be shown as stale. */
export function isStale(
  entry: { recheckAfter: string | null },
  nowIso: string,
): boolean {
  return entry.recheckAfter !== null && entry.recheckAfter <= nowIso;
}
