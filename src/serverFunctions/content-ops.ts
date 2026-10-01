import { createServerFn } from "@tanstack/react-start";
import { rethrowAsAppError } from "@/server/features/content-ops/contentOpsErrors";
import { EvidencePackService } from "@/server/features/content-ops/services/EvidencePackService";
import { ReviewService } from "@/server/features/content-ops/services/ReviewService";
import { requireProjectContext } from "@/serverFunctions/middleware";
import {
  contentOpsApprovePackSchema,
  contentOpsReviewDecisionSchema,
} from "@/types/schemas/contentOps";
import type { ThirdPartyPlatform } from "@/server/features/content-ops/rules/scoringRules";

export const reviewContentOpsDecision = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(contentOpsReviewDecisionSchema)
  .handler(async ({ data, context }) => {
    return ReviewService.reviewDecision({
      projectId: context.projectId,
      decisionId: data.decisionId,
      action: data.action,
      edits: {
        moneySitePageType: data.moneySitePageType,
        platformVerdicts: data.platformVerdicts as
          | Partial<
              Record<ThirdPartyPlatform, "DEPLOY" | "TEST" | "HOLD" | "SKIP">
            >
          | undefined,
      },
      reason: data.reason,
    }).catch(rethrowAsAppError);
  });

export const approveContentOpsEvidencePack = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(contentOpsApprovePackSchema)
  .handler(async ({ data, context }) => {
    return EvidencePackService.approvePack({
      projectId: context.projectId,
      packId: data.packId,
    }).catch(rethrowAsAppError);
  });
