import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { parseChecksReport, parseStoredDraft } from "../rules/contentChecks";
import { ApprovalsRepository } from "../repositories/ApprovalsRepository";
import { PublishAttemptsRepository } from "../repositories/PublishAttemptsRepository";
import { SiteChangeAlertsRepository } from "../repositories/SiteChangeAlertsRepository";
import { VersionsRepository } from "../repositories/VersionsRepository";

// Read models for the review UI.

async function listReviewQueue(projectId: string) {
  const rows = await VersionsRepository.listReviewQueue(projectId);
  return rows.map(({ checksReport, ...row }) => {
    const report = parseChecksReport(checksReport);
    return { ...row, blocking: report.blocking, warnings: report.warnings };
  });
}

async function getDetail(projectId: string, assetId: string) {
  const asset = await AssetsRepository.getById(projectId, assetId);
  if (!asset) {
    throw new ContentOpsError("ASSET_NOT_FOUND", "Work order not found.");
  }
  const [currentVersion, versions, approvals, comments, attempts] =
    await Promise.all([
      VersionsRepository.getByNumber(asset.id, asset.currentVersion),
      VersionsRepository.listSummaries(asset.id),
      ApprovalsRepository.listForAsset(asset.id),
      ApprovalsRepository.listComments(asset.id),
      PublishAttemptsRepository.listForAsset(asset.id),
    ]);
  const files = currentVersion
    ? await VersionsRepository.listFiles(currentVersion.id)
    : [];
  return {
    asset: {
      id: asset.id,
      title: asset.title,
      status: asset.status,
      targetUrl: asset.targetUrl,
      language: asset.language,
      pageAction: asset.pageAction,
      currentVersion: asset.currentVersion,
      publishedUrl: asset.publishedUrl,
      publishedAt: asset.publishedAt,
      updatedAt: asset.updatedAt,
    },
    version: currentVersion && {
      id: currentVersion.id,
      version: currentVersion.version,
      draft: parseStoredDraft(currentVersion.draft),
      taskBranch: currentVersion.taskBranch,
      baseCommit: currentVersion.baseCommit,
      headCommit: currentVersion.headCommit,
      patchId: currentVersion.patchId,
      diffText: currentVersion.diffText,
      files,
      checks: parseChecksReport(currentVersion.checksReport),
      // JSON text; null until a QA run attaches one.
      qaReport: currentVersion.qaReport,
      createdBy: currentVersion.createdBy,
      createdAt: currentVersion.createdAt,
    },
    versions,
    approvals: approvals.map((approval) => ({
      ...approval,
      // Only an approval on the current version, not revoked, can publish.
      isActive:
        approval.decision === "approved" &&
        approval.revokedAt === null &&
        approval.versionId === currentVersion?.id,
    })),
    comments,
    attempts: attempts.map((attempt) => ({
      ...attempt,
      hasScreenshots: Boolean(
        attempt.screenshotDesktopKey || attempt.screenshotMobileKey,
      ),
    })),
  };
}

async function listAttempts(projectId: string) {
  const rows = await PublishAttemptsRepository.listForProject(projectId, 100);
  return rows.map(({ attempt, assetTitle, targetUrl }) => ({
    ...attempt,
    assetTitle,
    targetUrl,
  }));
}

// Per-project numbers for the sites overview.
async function getOverviewCounts(organizationId: string) {
  const [pendingApprovals, openAlerts] = await Promise.all([
    PublishAttemptsRepository.countPendingApprovals(organizationId),
    SiteChangeAlertsRepository.countOpenByProject(organizationId),
  ]);
  return { pendingApprovals, openAlerts };
}

export const PageReviewService = {
  listReviewQueue,
  getDetail,
  listAttempts,
  getOverviewCounts,
};
