import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { OpportunitiesRepository } from "@/server/features/opportunity-intel/repositories/OpportunitiesRepository";
import { OpportunityCostEventsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityCostEventsRepository";
import { OpportunityDecisionLogRepository } from "@/server/features/opportunity-intel/repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityKeywordsRepository";
import { OpportunityReportsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityReportsRepository";
import { OpportunityRunsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityRunsRepository";
import { OpportunityScoresRepository } from "@/server/features/opportunity-intel/repositories/OpportunityScoresRepository";
import { OpportunitySerpRepository } from "@/server/features/opportunity-intel/repositories/OpportunitySerpRepository";
import { rethrowAsAppError } from "@/server/features/opportunity-intel/opportunityIntelErrors";
import { OPPORTUNITY_STATUSES } from "@/server/features/opportunity-intel/stateMachine";
import { OpportunityReviewService } from "@/server/features/opportunity-intel/services/ReviewService";
import { ScanRunner } from "@/server/features/opportunity-intel/services/ScanRunner";
import { todayUtc } from "@/server/features/opportunity-intel/services/costs";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import {
  opportunityIntelDetailSchema,
  opportunityIntelReviewSchema,
  opportunityIntelScanSchema,
  storedSerpLookupSchema,
} from "@/types/schemas/opportunityIntel";

// The opportunity funnel is account-level (no project until graduation), so
// everything here uses the authenticated-org context, not project context.

export const getOpportunityIntelOverview = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    const organizationId = context.organizationId;
    const [opportunities, counts, spend, runs, latestDaily] = await Promise.all(
      [
        OpportunitiesRepository.listByStatuses(
          organizationId,
          [...OPPORTUNITY_STATUSES],
          200,
        ),
        OpportunitiesRepository.countsByStatus(organizationId),
        OpportunityCostEventsRepository.spendByProviderForDate(
          organizationId,
          todayUtc(),
        ),
        OpportunityRunsRepository.listRecent(organizationId, 5),
        OpportunityReportsRepository.latestDaily(organizationId),
      ],
    );
    return {
      opportunities,
      counts,
      spendUsdByProvider: spend,
      runs,
      latestDaily,
    };
  });

export const getOpportunityIntelDetail = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(opportunityIntelDetailSchema)
  .handler(async ({ data, context }) => {
    const opportunity = await OpportunitiesRepository.getById(
      context.organizationId,
      data.opportunityId,
    );
    if (!opportunity) return null;
    const [keywords, snapshots, scores, log, detailReport] = await Promise.all([
      OpportunityKeywordsRepository.listByOpportunity(data.opportunityId),
      OpportunitySerpRepository.getLatestWithResults(data.opportunityId),
      OpportunityScoresRepository.listByOpportunity(data.opportunityId, 5),
      OpportunityDecisionLogRepository.listByOpportunity(
        data.opportunityId,
        30,
      ),
      OpportunityReportsRepository.latestDetailFor(
        context.organizationId,
        data.opportunityId,
      ),
    ]);
    return { opportunity, keywords, snapshots, scores, log, detailReport };
  });

// Read-through for Saved Keywords: archived SERP evidence the funnel already
// paid for, keyed by (keyword, market) across the org's opportunities.
export const getStoredSerpForKeyword = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(storedSerpLookupSchema)
  .handler(async ({ data, context }) => {
    return OpportunitySerpRepository.latestByKeywordForOrg(
      context.organizationId,
      data.keyword,
      data.locationCode,
    );
  });

/** Which of a project's saved keywords carry archived SERP evidence. */
export const listStoredSerpKeywordKeys = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ projectId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    return OpportunitySerpRepository.storedKeywordKeysForProject(
      context.organizationId,
      data.projectId,
    );
  });

export const reviewOpportunityIntel = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(opportunityIntelReviewSchema)
  .handler(async ({ data, context }) => {
    return OpportunityReviewService.review({
      opportunityId: data.opportunityId,
      action: data.action,
      organizationId: context.organizationId,
      projectId: data.projectId ?? null,
      notes: data.notes ?? null,
    }).catch(rethrowAsAppError);
  });

export const runOpportunityIntelScan = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(opportunityIntelScanSchema)
  .handler(async ({ data, context }) => {
    return ScanRunner.runOpportunityScan({
      customer: {
        userId: context.userId,
        userEmail: context.userEmail,
        organizationId: context.organizationId,
      },
      maxOpportunities: data.maxOpportunities,
    }).catch(rethrowAsAppError);
  });
