import { OpportunityIntelError } from "../opportunityIntelErrors";
import {
  assertOpportunityTransition,
  type OpportunityStatus,
} from "../stateMachine";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "../repositories/OpportunityKeywordsRepository";
import { GraduationService } from "./GraduationService";

// Human review actions on the top of the funnel. Everything is logged; the
// state machine rejects nonsense moves (e.g. resurrecting straight to
// shortlisted).

type ReviewAction =
  | "graduate"
  | "reject"
  | "watchlist"
  | "resume"
  | "sync_keywords";

async function review(input: {
  opportunityId: string;
  action: ReviewAction;
  organizationId: string;
  projectId?: string | null;
  notes?: string | null;
}): Promise<{ status: OpportunityStatus; promotedKeywords?: number }> {
  if (input.action === "sync_keywords") {
    if (!input.projectId) {
      throw new OpportunityIntelError(
        "PROJECT_NOT_FOUND",
        "sync_keywords requires a projectId.",
      );
    }
    const { promotedKeywords } = await GraduationService.syncKeywordsToProject({
      opportunityId: input.opportunityId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      notes: input.notes,
    });
    const opportunity = await OpportunitiesRepository.getById(
      input.organizationId,
      input.opportunityId,
    );
    if (!opportunity) {
      throw new OpportunityIntelError(
        "OPPORTUNITY_NOT_FOUND",
        "Opportunity not found.",
      );
    }
    return { status: opportunity.status, promotedKeywords };
  }

  if (input.action === "graduate") {
    if (!input.projectId) {
      throw new OpportunityIntelError(
        "GRADUATION_NOT_ALLOWED",
        "graduate requires a projectId (create the project first — it needs a real domain).",
      );
    }
    const { promotedKeywords } = await GraduationService.graduateOpportunity({
      opportunityId: input.opportunityId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      notes: input.notes,
    });
    return { status: "graduated", promotedKeywords };
  }

  const opportunity = await OpportunitiesRepository.getById(
    input.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }

  let target: OpportunityStatus;
  if (input.action === "reject") target = "rejected";
  else if (input.action === "watchlist") target = "watchlist";
  else {
    // resume: back into the pipeline at the stage its evidence supports.
    const keywords = await OpportunityKeywordsRepository.listByOpportunity(
      input.opportunityId,
    );
    target = keywords.some((row) => row.intent !== null)
      ? "keyword_scanned"
      : "discovered";
  }
  assertOpportunityTransition(opportunity.status, target);
  const transitioned = await OpportunitiesRepository.updateStatus(
    input.organizationId,
    input.opportunityId,
    opportunity.status,
    target,
  );
  if (!transitioned) {
    throw new OpportunityIntelError(
      "INVALID_STATUS_TRANSITION",
      "Opportunity changed while it was being reviewed; refresh and try again.",
    );
  }
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "review",
    decision: JSON.stringify({
      action: input.action,
      from: opportunity.status,
      to: target,
    }),
    reasonSummary: input.notes ?? null,
    createdBy: "user",
  });
  return { status: target };
}

export const OpportunityReviewService = {
  review,
};
