import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { assertAssetTransition } from "@/server/features/content-ops/stateMachine";
import { parseChecksReport } from "../rules/contentChecks";
import { ApprovalsRepository } from "../repositories/ApprovalsRepository";
import {
  PublishAttemptsRepository,
  ROLLBACK_ELIGIBLE_STATUSES,
} from "../repositories/PublishAttemptsRepository";
import { VersionsRepository } from "../repositories/VersionsRepository";

// Approval, rejection, revocation and rollback requests are human decisions.
// The only callers are session-authenticated server functions; MCP tools (API
// key credentials) deliberately have no path here, and the actor check keeps
// that true if one is ever wired up by mistake.
export type ReviewActor = { userId: string; source: "session" | "api_key" };

function assertSession(actor: ReviewActor) {
  if (actor.source !== "session" || actor.userId === "") {
    throw new ContentOpsError(
      "SESSION_REQUIRED",
      "Only a signed-in user can approve, reject, revoke or request a rollback.",
    );
  }
}

async function loadAsset(projectId: string, assetId: string) {
  const asset = await AssetsRepository.getById(projectId, assetId);
  if (!asset) {
    throw new ContentOpsError("ASSET_NOT_FOUND", "Work order not found.");
  }
  return asset;
}

// The version a decision is about must be the work order's current version.
async function loadCurrentVersion(
  asset: { id: string; currentVersion: number },
  versionId: string,
) {
  const version = await VersionsRepository.getById(asset.id, versionId);
  if (!version) {
    throw new ContentOpsError("VERSION_NOT_FOUND", "Version not found.");
  }
  if (version.version !== asset.currentVersion) {
    throw new ContentOpsError(
      "STALE_VERSION",
      `Version ${version.version} is no longer current (current is ${asset.currentVersion}); review the latest version.`,
    );
  }
  return version;
}

function normalizePublishAt(publishAt: string | undefined) {
  if (publishAt === undefined) return null;
  const time = Date.parse(publishAt);
  if (Number.isNaN(time)) {
    throw new ContentOpsError(
      "INVALID_PUBLISH_INPUT",
      "publishAt is not a valid date.",
    );
  }
  return new Date(time).toISOString();
}

async function approve(input: {
  projectId: string;
  assetId: string;
  versionId: string;
  actor: ReviewActor;
  publishAt?: string;
  comment?: string;
}) {
  assertSession(input.actor);
  const asset = await loadAsset(input.projectId, input.assetId);
  assertAssetTransition(asset.status, "ready_to_publish");
  const version = await loadCurrentVersion(asset, input.versionId);
  const report = parseChecksReport(version.checksReport);
  if (report.blocking > 0) {
    throw new ContentOpsError(
      "APPROVAL_BLOCKED",
      `${report.blocking} blocking check(s) must be fixed before approval.`,
      { blocking: report.blocking },
    );
  }
  const approvalId = await ApprovalsRepository.approve({
    assetId: asset.id,
    projectId: input.projectId,
    versionId: version.id,
    version: version.version,
    patchId: version.patchId,
    decidedByUserId: input.actor.userId,
    comment: input.comment ?? null,
    publishAt: normalizePublishAt(input.publishAt),
  });
  const after = await loadAsset(input.projectId, input.assetId);
  if (after.status !== "ready_to_publish") {
    throw new ContentOpsError(
      "STALE_VERSION",
      "The work order changed while it was being approved; refresh and try again.",
    );
  }
  return { approvalId, status: after.status };
}

async function reject(input: {
  projectId: string;
  assetId: string;
  versionId: string;
  actor: ReviewActor;
  comment: string;
}) {
  assertSession(input.actor);
  const asset = await loadAsset(input.projectId, input.assetId);
  assertAssetTransition(asset.status, "drafted");
  if (asset.status !== "qa_review" && asset.status !== "ready_to_publish") {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      `Cannot reject a work order in ${asset.status}.`,
    );
  }
  const version = await loadCurrentVersion(asset, input.versionId);
  await assertNoActiveAttempt(asset.id);
  const approvalId = await ApprovalsRepository.reject({
    assetId: asset.id,
    projectId: input.projectId,
    versionId: version.id,
    version: version.version,
    patchId: version.patchId,
    decidedByUserId: input.actor.userId,
    comment: input.comment,
    from: asset.status,
  });
  return { approvalId, status: "drafted" as const };
}

async function revoke(input: {
  projectId: string;
  assetId: string;
  actor: ReviewActor;
}) {
  assertSession(input.actor);
  const asset = await loadAsset(input.projectId, input.assetId);
  if (asset.status !== "ready_to_publish") {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "Only an approved work order that has not been published can have its approval revoked.",
    );
  }
  await assertNoActiveAttempt(asset.id);
  await ApprovalsRepository.revoke({
    assetId: asset.id,
    projectId: input.projectId,
    userId: input.actor.userId,
  });
  return { status: "qa_review" as const };
}

async function assertNoActiveAttempt(assetId: string) {
  const active = await PublishAttemptsRepository.listActiveForAsset(assetId);
  if (active.length > 0) {
    throw new ContentOpsError(
      "PUBLISH_CONFLICT",
      "A publish attempt is in progress for this work order.",
    );
  }
}

async function addComment(input: {
  projectId: string;
  assetId: string;
  userId: string;
  body: string;
}) {
  const asset = await loadAsset(input.projectId, input.assetId);
  const version = asset.currentVersion
    ? await VersionsRepository.getByNumber(asset.id, asset.currentVersion)
    : null;
  const commentId = await ApprovalsRepository.addComment({
    assetId: asset.id,
    versionId: version?.id ?? null,
    userId: input.userId,
    body: input.body,
  });
  return { commentId };
}

/** Queue a revert of a published page; the publisher picks it up. */
async function requestRollback(input: {
  projectId: string;
  assetId: string;
  actor: ReviewActor;
}) {
  assertSession(input.actor);
  const asset = await loadAsset(input.projectId, input.assetId);
  // ready_to_publish qualifies only after an unverified publish, i.e. when a
  // pushed commit exists (checked below).
  if (!ROLLBACK_ELIGIBLE_STATUSES.some((status) => status === asset.status)) {
    throw new ContentOpsError(
      "INVALID_STATUS_TRANSITION",
      "Only a published (or pushed but unverified) work order can be rolled back.",
    );
  }
  const attempts = await PublishAttemptsRepository.listActiveForAsset(asset.id);
  if (attempts.length > 0) {
    throw new ContentOpsError(
      "PUBLISH_CONFLICT",
      "A publish or rollback attempt is already in progress.",
    );
  }
  if (
    !(await PublishAttemptsRepository.getLastPublishedMergeCommit(asset.id))
  ) {
    throw new ContentOpsError(
      "PUBLISH_CONFLICT",
      "No recorded merge commit to roll back.",
    );
  }
  const attemptId = crypto.randomUUID();
  await PublishAttemptsRepository.insert({
    id: attemptId,
    assetId: asset.id,
    approvalId: null,
    kind: "rollback",
    status: "queued",
    requestedByUserId: input.actor.userId,
    createdAt: new Date().toISOString(),
  });
  return { attemptId };
}

export const ApprovalService = {
  approve,
  reject,
  revoke,
  addComment,
  requestRollback,
};
