import { z } from "zod";
import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { SitePagesService } from "@/server/features/page-plans/services/SitePagesService";
import { getBytesFromR2, putBytesToR2 } from "@/server/lib/r2";
import {
  PUBLISH_TEXT_MATCH_THRESHOLD,
  type PUBLISH_ERROR_STAGES,
} from "@/shared/pagePublishing";
import { parseStoredDraft } from "../rules/contentChecks";
import { ApprovalsRepository } from "../repositories/ApprovalsRepository";
import {
  ACTIVE_ATTEMPT_STATUSES,
  PublishAttemptsRepository,
} from "../repositories/PublishAttemptsRepository";
import { VersionsRepository } from "../repositories/VersionsRepository";

const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// "queued" is server-assigned (rollback requests); the publisher reports the rest.
export const ATTEMPT_STATUS_INPUTS = [
  "publishing",
  "deploying",
  "verifying",
  "published",
  "failed",
  "rolled_back",
  "unverified",
] as const;

type ScreenshotKind = "desktop" | "mobile";

type RecordAttemptInput = {
  projectId: string;
  // Omit to start a publish attempt for assetId + approvalId.
  attemptId?: string;
  assetId?: string;
  approvalId?: string;
  status: (typeof ATTEMPT_STATUS_INPUTS)[number];
  mergeCommit?: string;
  coolifyDeploymentUuid?: string;
  liveStatusCode?: number;
  textMatch?: number;
  liveCheck?: { noindex: boolean; canonical?: string | null; notes?: string };
  publishedUrl?: string;
  errorStage?: (typeof PUBLISH_ERROR_STAGES)[number];
  errorMessage?: string;
  screenshotDesktopPngBase64?: string;
  screenshotMobilePngBase64?: string;
};

const liveCheckSchema = z.object({
  noindex: z.boolean(),
  canonical: z.string().nullable().optional(),
  notes: z.string().optional(),
});

function decodeScreenshot(base64: string): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new ContentOpsError(
      "INVALID_PUBLISH_INPUT",
      `Screenshot exceeds ${MAX_SCREENSHOT_BYTES / 1024 / 1024}MB.`,
    );
  }
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new ContentOpsError(
      "INVALID_PUBLISH_INPUT",
      "Screenshot is not a PNG image.",
    );
  }
  return bytes;
}

/**
 * Work orders with a due, still-valid approval, plus queued rollback requests.
 * One project per call: the site registry row (repo, branch, deploy settings)
 * is returned once alongside.
 */
async function getQueue(projectId: string) {
  const now = new Date().toISOString();
  const [site, due, rollbacks] = await Promise.all([
    PublishAttemptsRepository.getSite(projectId),
    PublishAttemptsRepository.listDueApprovals(projectId, now),
    PublishAttemptsRepository.listQueuedRollbacks(projectId),
  ]);

  const publish = [];
  for (const { asset, approval, version } of due) {
    const draft = parseStoredDraft(version.draft);
    if (!draft) continue;
    const attempts = await PublishAttemptsRepository.listForAsset(asset.id);
    // An approval is spent once its change reached production, even when the
    // live check did not pass: the next step is a rollback or a new version.
    const pushed = attempts.some(
      (attempt) =>
        attempt.approvalId === approval.id && attempt.status === "unverified",
    );
    if (pushed) continue;
    const active = attempts.find((attempt) =>
      ACTIVE_ATTEMPT_STATUSES.includes(attempt.status),
    );
    publish.push({
      assetId: asset.id,
      approvalId: approval.id,
      versionId: version.id,
      version: version.version,
      approvedPatchId: approval.patchId,
      publishAt: approval.publishAt,
      targetUrl: asset.targetUrl,
      language: asset.language,
      pageAction: asset.pageAction,
      title: asset.title,
      taskBranch: version.taskBranch,
      baseCommit: version.baseCommit,
      headCommit: version.headCommit,
      draft,
      activeAttempt: active ? { id: active.id, status: active.status } : null,
      failedAttempts: attempts.filter(
        (attempt) =>
          attempt.approvalId === approval.id && attempt.status === "failed",
      ).length,
    });
  }

  const rollbackItems = [];
  for (const { attempt, asset } of rollbacks) {
    rollbackItems.push({
      attemptId: attempt.id,
      assetId: asset.id,
      requestedByUserId: attempt.requestedByUserId,
      requestedAt: attempt.createdAt,
      targetUrl: asset.targetUrl,
      // The commit to revert.
      mergeCommit: await PublishAttemptsRepository.getLastPublishedMergeCommit(
        asset.id,
      ),
    });
  }

  return {
    site: site && {
      githubRepo: site.githubRepo,
      productionBranch: site.productionBranch,
      autoDeploy: site.autoDeploy,
      coolifyAppUuid: site.coolifyAppUuid,
      domain: site.domain,
    },
    publish,
    rollbacks: rollbackItems,
  };
}

function acceptanceFailure(live: {
  statusCode: number | null;
  noindex: boolean | null;
  textMatch: number | null;
}): string | null {
  if (live.statusCode !== 200) {
    return `Live page returned status ${live.statusCode ?? "unknown"}, expected 200.`;
  }
  if (live.noindex === null) return "Live page noindex state was not reported.";
  if (live.noindex) return "Live page is noindex.";
  if (
    live.textMatch === null ||
    live.textMatch < PUBLISH_TEXT_MATCH_THRESHOLD
  ) {
    return `Live text match ${live.textMatch ?? "unknown"} is below ${PUBLISH_TEXT_MATCH_THRESHOLD}.`;
  }
  return null;
}

async function startPublishAttempt(
  projectId: string,
  assetId: string,
  approvalId: string,
) {
  const asset = await AssetsRepository.getById(projectId, assetId);
  if (!asset) {
    throw new ContentOpsError("ASSET_NOT_FOUND", "Work order not found.");
  }
  const approval = await ApprovalsRepository.getById(assetId, approvalId);
  const version = await VersionsRepository.getByNumber(
    assetId,
    asset.currentVersion,
  );
  if (
    asset.status !== "ready_to_publish" ||
    !approval ||
    approval.decision !== "approved" ||
    approval.revokedAt !== null ||
    approval.versionId !== version?.id
  ) {
    throw new ContentOpsError(
      "PUBLISH_CONFLICT",
      "The approval is not valid for the current version of this work order.",
    );
  }
  if (
    (await PublishAttemptsRepository.listActiveForAsset(assetId)).length > 0
  ) {
    throw new ContentOpsError(
      "PUBLISH_CONFLICT",
      "Another publish attempt is already in progress.",
    );
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await PublishAttemptsRepository.insert({
    id,
    assetId,
    approvalId,
    kind: "publish",
    status: "publishing",
    startedAt: now,
    createdAt: now,
  });
  return id;
}

/**
 * Create or update a publish/rollback attempt. The server decides whether a
 * live check counts as published; a publisher-reported "published" that fails
 * acceptance is stored as "unverified". A fingerprint failure voids the
 * approval and returns the work order to qa_review.
 */
async function recordAttempt(input: RecordAttemptInput) {
  // Validate and decode first so a bad payload never leaves a half-made attempt.
  const screenshots: Array<[ScreenshotKind, Uint8Array]> = [];
  if (input.screenshotDesktopPngBase64) {
    screenshots.push([
      "desktop",
      decodeScreenshot(input.screenshotDesktopPngBase64),
    ]);
  }
  if (input.screenshotMobilePngBase64) {
    screenshots.push([
      "mobile",
      decodeScreenshot(input.screenshotMobilePngBase64),
    ]);
  }

  let attemptId = input.attemptId;
  if (!attemptId) {
    if (!input.assetId || !input.approvalId) {
      throw new ContentOpsError(
        "INVALID_PUBLISH_INPUT",
        "assetId and approvalId are required to start an attempt.",
      );
    }
    attemptId = await startPublishAttempt(
      input.projectId,
      input.assetId,
      input.approvalId,
    );
  }

  const found = await PublishAttemptsRepository.getWithAsset(attemptId);
  if (!found || found.asset.projectId !== input.projectId) {
    throw new ContentOpsError(
      "ATTEMPT_NOT_FOUND",
      "Publish attempt not found.",
    );
  }
  const { attempt, asset } = found;
  if (!ACTIVE_ATTEMPT_STATUSES.includes(attempt.status)) {
    throw new ContentOpsError(
      "PUBLISH_CONFLICT",
      `Attempt already finished as ${attempt.status}.`,
    );
  }

  const keys: { screenshotDesktopKey?: string; screenshotMobileKey?: string } =
    {};
  for (const [kind, bytes] of screenshots) {
    const key = `publish/${attemptId}/${kind}.png`;
    await putBytesToR2(key, bytes, "image/png");
    if (kind === "desktop") keys.screenshotDesktopKey = key;
    else keys.screenshotMobileKey = key;
  }

  const previousCheck = attempt.liveCheckSummary
    ? liveCheckSchema.safeParse(JSON.parse(attempt.liveCheckSummary))
    : null;
  const fields = {
    ...keys,
    ...(input.mergeCommit && { mergeCommit: input.mergeCommit }),
    ...(input.coolifyDeploymentUuid && {
      coolifyDeploymentUuid: input.coolifyDeploymentUuid,
    }),
    ...(input.liveStatusCode !== undefined && {
      liveStatusCode: input.liveStatusCode,
    }),
    ...(input.textMatch !== undefined && { textMatch: input.textMatch }),
    ...(input.liveCheck && {
      liveCheckSummary: JSON.stringify(input.liveCheck),
    }),
    ...(input.errorStage && { errorStage: input.errorStage }),
    ...(input.errorMessage && { errorMessage: input.errorMessage }),
  };

  if (input.status === "published") {
    if (attempt.kind !== "publish") {
      throw new ContentOpsError(
        "INVALID_PUBLISH_INPUT",
        "A rollback ends as rolled_back, not published.",
      );
    }
    const failure = acceptanceFailure({
      statusCode: input.liveStatusCode ?? attempt.liveStatusCode,
      noindex:
        input.liveCheck?.noindex ??
        (previousCheck?.success ? previousCheck.data.noindex : null),
      textMatch: input.textMatch ?? attempt.textMatch,
    });
    if (failure) {
      await PublishAttemptsRepository.update(attemptId, {
        ...fields,
        status: "unverified",
        errorStage: "verify",
        errorMessage: failure,
        finishedAt: new Date().toISOString(),
      });
      return { attemptId, status: "unverified" as const, reason: failure };
    }
    const publishedUrl = input.publishedUrl ?? asset.targetUrl;
    await PublishAttemptsRepository.markPublished({
      attemptId,
      assetId: asset.id,
      fields,
      publishedUrl,
    });
    // A verified page joins the site page inventory right away, so the next
    // drafts can link to a new page without an "unknown page" warning.
    if (publishedUrl) {
      await SitePagesService.importPages({
        projectId: input.projectId,
        pages: [
          {
            url: publishedUrl,
            language: asset.language ?? undefined,
            statusCode: 200,
            noindex: false,
            source: "publish",
            lastCheckedAt: new Date().toISOString(),
          },
        ],
      });
    }
    return { attemptId, status: "published" as const, reason: null };
  }

  if (input.status === "rolled_back") {
    if (attempt.kind !== "rollback") {
      throw new ContentOpsError(
        "INVALID_PUBLISH_INPUT",
        "Only a rollback attempt can end as rolled_back.",
      );
    }
    await PublishAttemptsRepository.markRolledBack({
      attemptId,
      assetId: asset.id,
      fields,
    });
    return { attemptId, status: "rolled_back" as const, reason: null };
  }

  if (
    input.status === "failed" &&
    input.errorStage === "fingerprint" &&
    attempt.kind === "publish"
  ) {
    const reason =
      input.errorMessage ??
      "The built patch does not match the approved fingerprint.";
    const approval = attempt.approvalId
      ? await ApprovalsRepository.getById(asset.id, attempt.approvalId)
      : null;
    await PublishAttemptsRepository.failFingerprint({
      attemptId,
      assetId: asset.id,
      versionId: approval?.versionId ?? null,
      fields,
      reason: `Publish stopped, approval voided: ${reason}`,
    });
    return { attemptId, status: "failed" as const, reason };
  }

  const finished = input.status === "failed" || input.status === "unverified";
  await PublishAttemptsRepository.update(attemptId, {
    ...fields,
    status: input.status,
    ...(finished && { finishedAt: new Date().toISOString() }),
  });
  return { attemptId, status: input.status, reason: null };
}

async function readScreenshot(
  projectId: string,
  attemptId: string,
  kind: ScreenshotKind,
) {
  const found = await PublishAttemptsRepository.getWithAsset(attemptId);
  if (!found || found.asset.projectId !== projectId) {
    throw new ContentOpsError(
      "ATTEMPT_NOT_FOUND",
      "Publish attempt not found.",
    );
  }
  const key =
    kind === "desktop"
      ? found.attempt.screenshotDesktopKey
      : found.attempt.screenshotMobileKey;
  const bytes = key ? await getBytesFromR2(key) : null;
  if (!bytes) {
    throw new ContentOpsError("ATTEMPT_NOT_FOUND", "Screenshot not found.");
  }
  return {
    contentType: "image/png" as const,
    base64: Buffer.from(bytes).toString("base64"),
  };
}

export const PublishService = { getQueue, recordAttempt, readScreenshot };
