import { OpportunityIntelError } from "./opportunityIntelErrors";

// The discovery funnel's state machine. Stages select work by status, so an
// out-of-order write would corrupt the batch runner's idempotency — services
// call assertOpportunityTransition before every status write and fail loudly.

export const OPPORTUNITY_STATUSES = [
  "discovered",
  "keyword_scanned",
  "serp_validated",
  // V0.2+ stages, pre-declared so later phases extend data, not the machine:
  "competitor_validated",
  "buyer_validated",
  "supply_validated",
  "economics_validated",
  "shortlisted",
  "graduated",
  "rejected",
  "watchlist",
  "paused",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

// Side-state semantics: rejected = a gate or human said no (kept forever as
// the dedup guard; a human may resurrect it to watchlist). watchlist = parked
// on judgment, resumable anywhere mid-pipeline (services know the real stage
// from which columns are populated). paused = system/budget hold, same resume
// rules as watchlist. graduated is terminal.
const SIDE_TARGETS = ["rejected", "watchlist", "paused"] as const;
const RESUME_TARGETS = [
  "discovered",
  "keyword_scanned",
  "serp_validated",
  "competitor_validated",
  "buyer_validated",
  "supply_validated",
  "economics_validated",
  "shortlisted",
] as const;

const OPPORTUNITY_TRANSITIONS: Record<
  OpportunityStatus,
  readonly OpportunityStatus[]
> = {
  discovered: ["keyword_scanned", ...SIDE_TARGETS],
  keyword_scanned: ["serp_validated", ...SIDE_TARGETS],
  // serp_validated is transient: scoring sets it, then the SERP gate
  // immediately moves the opportunity on (V0.2 inserts competitor_validated).
  serp_validated: ["shortlisted", "competitor_validated", ...SIDE_TARGETS],
  competitor_validated: ["buyer_validated", "shortlisted", ...SIDE_TARGETS],
  buyer_validated: ["supply_validated", "shortlisted", ...SIDE_TARGETS],
  supply_validated: ["economics_validated", "shortlisted", ...SIDE_TARGETS],
  economics_validated: ["shortlisted", ...SIDE_TARGETS],
  shortlisted: ["graduated", "rejected", "watchlist"],
  graduated: [],
  rejected: ["watchlist"],
  watchlist: [...RESUME_TARGETS, "rejected", "paused"],
  paused: [...RESUME_TARGETS, "rejected", "watchlist"],
};

export function assertOpportunityTransition(
  from: OpportunityStatus,
  to: OpportunityStatus,
): void {
  if (!OPPORTUNITY_TRANSITIONS[from]?.includes(to)) {
    throw new OpportunityIntelError(
      "INVALID_STATUS_TRANSITION",
      `Invalid opportunity status transition: ${from} -> ${to}`,
      { from, to },
    );
  }
}
