import { ContentOpsError } from "@/server/features/content-ops/contentOpsErrors";
import { SiteChangeAlertsRepository } from "../repositories/SiteChangeAlertsRepository";

/** Record production-branch commits that have no approval. Idempotent per sha. */
async function report(input: {
  projectId: string;
  commits: Array<{ sha: string; author?: string; message?: string }>;
}) {
  const inserted = await SiteChangeAlertsRepository.insertMany(
    input.projectId,
    input.commits.map((commit) => ({
      commitSha: commit.sha,
      author: commit.author ?? null,
      message: commit.message ?? null,
    })),
  );
  return {
    inserted: inserted.length,
    alreadyKnown: input.commits.length - inserted.length,
  };
}

async function listOpen(projectId: string) {
  return SiteChangeAlertsRepository.listOpen(projectId);
}

async function resolve(input: {
  projectId: string;
  alertId: string;
  userId: string;
}) {
  const resolved = await SiteChangeAlertsRepository.resolve(
    input.projectId,
    input.alertId,
    input.userId,
  );
  if (!resolved) {
    throw new ContentOpsError(
      "ASSET_NOT_FOUND",
      "Alert not found or already resolved.",
    );
  }
}

export const SiteChangeAlertService = { report, listOpen, resolve };
