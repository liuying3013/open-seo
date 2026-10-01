import { z } from "zod";
import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { EvidencePacksRepository } from "@/server/features/content-ops/repositories/EvidencePacksRepository";
import { assertAssetTransition } from "@/server/features/content-ops/stateMachine";
import { runContentChecks, type ContentDraft } from "../rules/contentChecks";
import { VersionsRepository } from "../repositories/VersionsRepository";
import type { VERSION_FILE_CHANGES } from "@/shared/pagePublishing";

const MAX_DIFF_CHARS = 256 * 1024;

type SubmitVersionInput = {
  projectId: string;
  assetId: string;
  draft: ContentDraft;
  implementation: {
    taskBranch: string;
    baseCommit: string;
    headCommit: string;
    patchId: string;
    diffText: string;
    files: Array<{
      path: string;
      change: (typeof VERSION_FILE_CHANGES)[number];
    }>;
  };
};

// Evidence packs are stored as JSON text; only prohibitedClaims matters here
// and a pack from an older prompt version may not have it.
const packClaimsSchema = z.object({
  prohibitedClaims: z.array(z.string()).default([]),
});

async function prohibitedClaimsFor(clusterId: string) {
  const pack = await EvidencePacksRepository.getLatestForCluster(clusterId);
  if (!pack) return null;
  try {
    const parsed = packClaimsSchema.safeParse(JSON.parse(pack.content));
    return parsed.success ? parsed.data.prohibitedClaims : null;
  } catch {
    return null;
  }
}

function truncateDiff(diff: string) {
  return diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`
    : diff;
}

/**
 * Save a new content version for a page work order: runs the deterministic
 * checks, bumps the work order's current version and moves it to qa_review.
 * Approvals on earlier versions stop being valid because validity requires the
 * approval's version to be the current one.
 */
async function submit(input: SubmitVersionInput) {
  const asset = await AssetsRepository.getById(input.projectId, input.assetId);
  if (!asset) {
    throw new ContentOpsError("ASSET_NOT_FOUND", "Work order not found.");
  }
  if (asset.platform !== "money_site") {
    throw new ContentOpsError(
      "INVALID_PUBLISH_INPUT",
      "Only money_site work orders take page versions.",
    );
  }
  if (asset.status !== "qa_review") {
    assertAssetTransition(asset.status, "qa_review");
  }

  const checks = runContentChecks(input.draft, {
    prohibitedClaims: await prohibitedClaimsFor(asset.clusterId),
    // Extension point: pass the site's page URLs here once site_pages exists.
    knownPageUrls: null,
  });
  const version = asset.currentVersion + 1;
  try {
    const versionId = await VersionsRepository.create({
      assetId: asset.id,
      projectId: input.projectId,
      expectedVersion: asset.currentVersion,
      version,
      draft: JSON.stringify(input.draft),
      title: input.draft.title,
      language: input.draft.language ?? null,
      taskBranch: input.implementation.taskBranch,
      baseCommit: input.implementation.baseCommit,
      headCommit: input.implementation.headCommit,
      patchId: input.implementation.patchId,
      diffText: truncateDiff(input.implementation.diffText),
      checksReport: JSON.stringify(checks),
      files: input.implementation.files,
    });
    return { versionId, version, status: "qa_review" as const, checks };
  } catch (error) {
    const current = await AssetsRepository.getById(input.projectId, asset.id);
    if (current && current.currentVersion !== asset.currentVersion) {
      throw new ContentOpsError(
        "STALE_VERSION",
        "Another version was submitted at the same time; fetch the work order and resubmit.",
      );
    }
    throw error;
  }
}

export const ContentVersionService = { submit };
