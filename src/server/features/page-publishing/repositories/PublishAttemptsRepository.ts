import { and, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  contentAssetApprovals,
  contentAssetComments,
  contentAssets,
  contentAssetVersions,
  projects,
  projectSites,
  publishAttempts,
} from "@/db/schema";
import { PUBLISHED_ASSET_STATUSES } from "@/shared/pagePublishing";
import { revokeActive } from "./ApprovalsRepository";

type AttemptRow = typeof publishAttempts.$inferSelect;
type AttemptStatus = AttemptRow["status"];

export const ACTIVE_ATTEMPT_STATUSES: AttemptStatus[] = [
  "queued",
  "publishing",
  "deploying",
  "verifying",
];

async function insert(values: typeof publishAttempts.$inferInsert) {
  await db.insert(publishAttempts).values(values);
}

// The attempt joined to its work order so callers can check project ownership.
async function getWithAsset(attemptId: string) {
  const [row] = await db
    .select({ attempt: publishAttempts, asset: contentAssets })
    .from(publishAttempts)
    .innerJoin(contentAssets, eq(contentAssets.id, publishAttempts.assetId))
    .where(eq(publishAttempts.id, attemptId))
    .limit(1);
  return row ?? null;
}

type AttemptFields = Partial<
  Omit<typeof publishAttempts.$inferInsert, "id" | "assetId" | "createdAt">
>;

async function update(attemptId: string, fields: AttemptFields) {
  await db
    .update(publishAttempts)
    .set(fields)
    .where(eq(publishAttempts.id, attemptId));
}

/** Verified publish: the attempt and the work order become published together. */
async function markPublished(input: {
  attemptId: string;
  assetId: string;
  fields: AttemptFields;
  publishedUrl: string | null;
}) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(publishAttempts)
      .set({ ...input.fields, status: "published", finishedAt: now })
      .where(eq(publishAttempts.id, input.attemptId)),
    tx
      .update(contentAssets)
      .set({
        status: "published",
        publishedUrl: input.publishedUrl,
        publishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          eq(contentAssets.status, "ready_to_publish"),
        ),
      ),
  ]);
}

/**
 * The approved patch no longer matches what the publisher built: the attempt
 * fails, the approval is voided, and the work order returns to review with the
 * reason on record.
 */
async function failFingerprint(input: {
  attemptId: string;
  assetId: string;
  versionId: string | null;
  fields: AttemptFields;
  reason: string;
}) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(publishAttempts)
      .set({ ...input.fields, status: "failed", finishedAt: now })
      .where(eq(publishAttempts.id, input.attemptId)),
    revokeActive(tx, input.assetId, now, null),
    tx
      .update(contentAssets)
      .set({ status: "qa_review", updatedAt: now })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          eq(contentAssets.status, "ready_to_publish"),
        ),
      ),
    tx.insert(contentAssetComments).values({
      id: crypto.randomUUID(),
      assetId: input.assetId,
      versionId: input.versionId,
      userId: "system",
      body: input.reason,
      createdAt: now,
    }),
  ]);
}

/** A verified rollback: the page is reverted, so the work goes back to drafting. */
async function markRolledBack(input: {
  attemptId: string;
  assetId: string;
  fields: AttemptFields;
}) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx
      .update(publishAttempts)
      .set({ ...input.fields, status: "rolled_back", finishedAt: now })
      .where(eq(publishAttempts.id, input.attemptId)),
    tx
      .update(contentAssets)
      .set({
        status: "drafted",
        publishedUrl: null,
        publishedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          inArray(contentAssets.status, [...PUBLISHED_ASSET_STATUSES]),
        ),
      ),
  ]);
}

async function listActiveForAsset(assetId: string) {
  return db
    .select()
    .from(publishAttempts)
    .where(
      and(
        eq(publishAttempts.assetId, assetId),
        inArray(publishAttempts.status, ACTIVE_ATTEMPT_STATUSES),
      ),
    );
}

async function getLastPublishedMergeCommit(assetId: string) {
  const [row] = await db
    .select({ mergeCommit: publishAttempts.mergeCommit })
    .from(publishAttempts)
    .where(
      and(
        eq(publishAttempts.assetId, assetId),
        eq(publishAttempts.kind, "publish"),
        eq(publishAttempts.status, "published"),
      ),
    )
    .orderBy(desc(publishAttempts.createdAt))
    .limit(1);
  return row?.mergeCommit ?? null;
}

async function listForAsset(assetId: string) {
  return db
    .select()
    .from(publishAttempts)
    .where(eq(publishAttempts.assetId, assetId))
    .orderBy(desc(publishAttempts.createdAt));
}

async function listForProject(projectId: string, limit: number) {
  return db
    .select({
      attempt: publishAttempts,
      assetTitle: contentAssets.title,
      targetUrl: contentAssets.targetUrl,
    })
    .from(publishAttempts)
    .innerJoin(contentAssets, eq(contentAssets.id, publishAttempts.assetId))
    .where(eq(contentAssets.projectId, projectId))
    .orderBy(desc(publishAttempts.createdAt))
    .limit(limit);
}

/**
 * Approved, un-revoked approvals of the current version whose publish time has
 * come, for work orders still waiting to publish.
 */
async function listDueApprovals(projectId: string, now: string) {
  return db
    .select({
      asset: contentAssets,
      approval: contentAssetApprovals,
      version: contentAssetVersions,
    })
    .from(contentAssetApprovals)
    .innerJoin(
      contentAssets,
      eq(contentAssets.id, contentAssetApprovals.assetId),
    )
    .innerJoin(
      contentAssetVersions,
      and(
        eq(contentAssetVersions.id, contentAssetApprovals.versionId),
        eq(contentAssetVersions.version, contentAssets.currentVersion),
      ),
    )
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.status, "ready_to_publish"),
        eq(contentAssetApprovals.decision, "approved"),
        isNull(contentAssetApprovals.revokedAt),
        or(
          isNull(contentAssetApprovals.publishAt),
          lte(contentAssetApprovals.publishAt, now),
        ),
      ),
    );
}

async function listQueuedRollbacks(projectId: string) {
  return db
    .select({ attempt: publishAttempts, asset: contentAssets })
    .from(publishAttempts)
    .innerJoin(contentAssets, eq(contentAssets.id, publishAttempts.assetId))
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(publishAttempts.kind, "rollback"),
        eq(publishAttempts.status, "queued"),
        inArray(contentAssets.status, [...PUBLISHED_ASSET_STATUSES]),
      ),
    )
    .orderBy(publishAttempts.createdAt);
}

async function getSite(projectId: string) {
  const [row] = await db
    .select()
    .from(projectSites)
    .where(eq(projectSites.projectId, projectId))
    .limit(1);
  return row ?? null;
}

// Per-project counts of work orders awaiting review, for the sites overview.
async function countPendingApprovals(organizationId: string) {
  const rows = await db
    .select({ projectId: contentAssets.projectId })
    .from(contentAssets)
    .innerJoin(projects, eq(projects.id, contentAssets.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        eq(contentAssets.status, "qa_review"),
      ),
    );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.projectId] = (counts[row.projectId] ?? 0) + 1;
  }
  return counts;
}

export const PublishAttemptsRepository = {
  insert,
  getWithAsset,
  update,
  markPublished,
  failFingerprint,
  markRolledBack,
  listActiveForAsset,
  getLastPublishedMergeCommit,
  listForAsset,
  listForProject,
  listDueApprovals,
  listQueuedRollbacks,
  getSite,
  countPendingApprovals,
};
