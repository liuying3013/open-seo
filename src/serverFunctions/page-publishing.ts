import { createServerFn } from "@tanstack/react-start";
import { rethrowAsAppError } from "@/server/features/content-ops/contentOpsErrors";
import { ApprovalService } from "@/server/features/page-publishing/services/ApprovalService";
import { PageReviewService } from "@/server/features/page-publishing/services/PageReviewService";
import { PublishService } from "@/server/features/page-publishing/services/PublishService";
import { SiteChangeAlertService } from "@/server/features/page-publishing/services/SiteChangeAlertService";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";
import {
  approvePageVersionSchema,
  commentOnPageSchema,
  pageReviewAssetSchema,
  pageReviewProjectSchema,
  publishScreenshotSchema,
  rejectPageVersionSchema,
  resolveSiteAlertSchema,
} from "@/types/schemas/pagePublishing";

// Page approval is a human decision: every mutation here runs as a signed-in
// session user. API-key (MCP) callers have no route to approve, reject, revoke
// or request a rollback.

export const listPageReviewQueue = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageReviewProjectSchema)
  .handler(({ context }) =>
    PageReviewService.listReviewQueue(context.projectId).catch(
      rethrowAsAppError,
    ),
  );

export const getPageReviewDetail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageReviewAssetSchema)
  .handler(({ data, context }) =>
    PageReviewService.getDetail(context.projectId, data.assetId).catch(
      rethrowAsAppError,
    ),
  );

export const listPublishAttempts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageReviewProjectSchema)
  .handler(({ context }) =>
    PageReviewService.listAttempts(context.projectId).catch(rethrowAsAppError),
  );

export const approvePageVersion = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(approvePageVersionSchema)
  .handler(({ data, context }) =>
    ApprovalService.approve({
      projectId: context.projectId,
      assetId: data.assetId,
      versionId: data.versionId,
      publishAt: data.publishAt,
      comment: data.comment,
      actor: { userId: context.userId, source: "session" },
    }).catch(rethrowAsAppError),
  );

export const rejectPageVersion = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(rejectPageVersionSchema)
  .handler(({ data, context }) =>
    ApprovalService.reject({
      projectId: context.projectId,
      assetId: data.assetId,
      versionId: data.versionId,
      comment: data.comment,
      actor: { userId: context.userId, source: "session" },
    }).catch(rethrowAsAppError),
  );

export const revokePageApproval = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageReviewAssetSchema)
  .handler(({ data, context }) =>
    ApprovalService.revoke({
      projectId: context.projectId,
      assetId: data.assetId,
      actor: { userId: context.userId, source: "session" },
    }).catch(rethrowAsAppError),
  );

export const commentOnPage = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(commentOnPageSchema)
  .handler(({ data, context }) =>
    ApprovalService.addComment({
      projectId: context.projectId,
      assetId: data.assetId,
      userId: context.userId,
      body: data.body,
    }).catch(rethrowAsAppError),
  );

export const requestPageRollback = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageReviewAssetSchema)
  .handler(({ data, context }) =>
    ApprovalService.requestRollback({
      projectId: context.projectId,
      assetId: data.assetId,
      actor: { userId: context.userId, source: "session" },
    }).catch(rethrowAsAppError),
  );

export const getPublishScreenshot = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(publishScreenshotSchema)
  .handler(({ data, context }) =>
    PublishService.readScreenshot(
      context.projectId,
      data.attemptId,
      data.kind,
    ).catch(rethrowAsAppError),
  );

export const listSiteChangeAlerts = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(pageReviewProjectSchema)
  .handler(({ context }) => SiteChangeAlertService.listOpen(context.projectId));

export const resolveSiteChangeAlert = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(resolveSiteAlertSchema)
  .handler(({ data, context }) =>
    SiteChangeAlertService.resolve({
      projectId: context.projectId,
      alertId: data.alertId,
      userId: context.userId,
    }).catch(rethrowAsAppError),
  );

export const getPublishingOverviewCounts = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) =>
    PageReviewService.getOverviewCounts(context.organizationId),
  );
