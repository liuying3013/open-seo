import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  contentAssetApprovals,
  contentAssetComments,
  contentAssets,
} from "@/db/schema";

type Decision = {
  assetId: string;
  projectId: string;
  versionId: string;
  version: number;
  patchId: string | null;
  decidedByUserId: string;
  comment: string | null;
};

// Marks every still-active approval of the asset as revoked.
export function revokeActive(
  tx: Parameters<Parameters<typeof runBatch>[0]>[0],
  assetId: string,
  now: string,
  revokedByUserId: string | null,
) {
  return tx
    .update(contentAssetApprovals)
    .set({ revokedAt: now, revokedByUserId })
    .where(
      and(
        eq(contentAssetApprovals.assetId, assetId),
        eq(contentAssetApprovals.decision, "approved"),
        isNull(contentAssetApprovals.revokedAt),
      ),
    );
}

/** qa_review -> ready_to_publish with a new approval. Returns the approval id. */
async function approve(input: Decision & { publishAt: string | null }) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await runBatch((tx) => [
    revokeActive(tx, input.assetId, now, input.decidedByUserId),
    tx.insert(contentAssetApprovals).values({
      id,
      assetId: input.assetId,
      versionId: input.versionId,
      patchId: input.patchId,
      decision: "approved",
      comment: input.comment,
      publishAt: input.publishAt,
      decidedByUserId: input.decidedByUserId,
      decidedAt: now,
    }),
    tx
      .update(contentAssets)
      .set({ status: "ready_to_publish", updatedAt: now })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          eq(contentAssets.projectId, input.projectId),
          eq(contentAssets.status, "qa_review"),
          eq(contentAssets.currentVersion, input.version),
        ),
      ),
  ]);
  return id;
}

/** qa_review or ready_to_publish -> drafted, recording the rejection. */
async function reject(
  input: Decision & { from: "qa_review" | "ready_to_publish" },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await runBatch((tx) => [
    revokeActive(tx, input.assetId, now, input.decidedByUserId),
    tx.insert(contentAssetApprovals).values({
      id,
      assetId: input.assetId,
      versionId: input.versionId,
      patchId: input.patchId,
      decision: "rejected",
      comment: input.comment,
      decidedByUserId: input.decidedByUserId,
      decidedAt: now,
    }),
    tx
      .update(contentAssets)
      .set({ status: "drafted", updatedAt: now })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          eq(contentAssets.projectId, input.projectId),
          eq(contentAssets.status, input.from),
          eq(contentAssets.currentVersion, input.version),
        ),
      ),
  ]);
  return id;
}

/** ready_to_publish -> qa_review, voiding the active approval. */
async function revoke(input: {
  assetId: string;
  projectId: string;
  userId: string;
}) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    revokeActive(tx, input.assetId, now, input.userId),
    tx
      .update(contentAssets)
      .set({ status: "qa_review", updatedAt: now })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          eq(contentAssets.projectId, input.projectId),
          eq(contentAssets.status, "ready_to_publish"),
        ),
      ),
  ]);
}

async function getActive(assetId: string) {
  const [row] = await db
    .select()
    .from(contentAssetApprovals)
    .where(
      and(
        eq(contentAssetApprovals.assetId, assetId),
        eq(contentAssetApprovals.decision, "approved"),
        isNull(contentAssetApprovals.revokedAt),
      ),
    )
    .orderBy(desc(contentAssetApprovals.decidedAt))
    .limit(1);
  return row ?? null;
}

async function getById(assetId: string, approvalId: string) {
  const [row] = await db
    .select()
    .from(contentAssetApprovals)
    .where(
      and(
        eq(contentAssetApprovals.assetId, assetId),
        eq(contentAssetApprovals.id, approvalId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function listForAsset(assetId: string) {
  return db
    .select()
    .from(contentAssetApprovals)
    .where(eq(contentAssetApprovals.assetId, assetId))
    .orderBy(desc(contentAssetApprovals.decidedAt));
}

async function addComment(input: {
  assetId: string;
  versionId: string | null;
  userId: string;
  body: string;
}) {
  const id = crypto.randomUUID();
  await db.insert(contentAssetComments).values({
    id,
    createdAt: new Date().toISOString(),
    ...input,
  });
  return id;
}

async function listComments(assetId: string) {
  return db
    .select()
    .from(contentAssetComments)
    .where(eq(contentAssetComments.assetId, assetId))
    .orderBy(asc(contentAssetComments.createdAt));
}

export const ApprovalsRepository = {
  approve,
  reject,
  revoke,
  getActive,
  getById,
  listForAsset,
  addComment,
  listComments,
};
