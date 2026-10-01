import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  contentAssets,
  contentAssetVersionFiles,
  contentAssetVersions,
} from "@/db/schema";

type NewVersion = {
  assetId: string;
  projectId: string;
  // The currentVersion read before computing `version`; the asset update only
  // applies if nobody submitted in between.
  expectedVersion: number;
  version: number;
  draft: string;
  title: string;
  language: string | null;
  taskBranch: string | null;
  baseCommit: string | null;
  headCommit: string | null;
  patchId: string | null;
  diffText: string | null;
  checksReport: string;
  files: Array<{ path: string; change: "added" | "modified" | "deleted" }>;
};

/**
 * Insert a version, its files and the work order's new state in one atomic
 * batch. The unique (asset_id, version) index fails the whole batch when two
 * submissions race for the same number.
 */
async function create(input: NewVersion): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await runBatch((tx) => [
    tx.insert(contentAssetVersions).values({
      id,
      assetId: input.assetId,
      version: input.version,
      draft: input.draft,
      taskBranch: input.taskBranch,
      baseCommit: input.baseCommit,
      headCommit: input.headCommit,
      patchId: input.patchId,
      diffText: input.diffText,
      checksReport: input.checksReport,
      createdBy: "agent",
      createdAt: now,
    }),
    ...input.files.map((file) =>
      tx.insert(contentAssetVersionFiles).values({
        versionId: id,
        path: file.path,
        change: file.change,
      }),
    ),
    tx
      .update(contentAssets)
      .set({
        currentVersion: input.version,
        status: "qa_review",
        draft: input.draft,
        title: input.title,
        ...(input.language ? { language: input.language } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(contentAssets.id, input.assetId),
          eq(contentAssets.projectId, input.projectId),
          eq(contentAssets.currentVersion, input.expectedVersion),
        ),
      ),
  ]);
  return id;
}

async function getById(assetId: string, versionId: string) {
  const [row] = await db
    .select()
    .from(contentAssetVersions)
    .where(
      and(
        eq(contentAssetVersions.assetId, assetId),
        eq(contentAssetVersions.id, versionId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function getByNumber(assetId: string, version: number) {
  const [row] = await db
    .select()
    .from(contentAssetVersions)
    .where(
      and(
        eq(contentAssetVersions.assetId, assetId),
        eq(contentAssetVersions.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function listFiles(versionId: string) {
  return db
    .select({
      path: contentAssetVersionFiles.path,
      change: contentAssetVersionFiles.change,
    })
    .from(contentAssetVersionFiles)
    .where(eq(contentAssetVersionFiles.versionId, versionId))
    .orderBy(asc(contentAssetVersionFiles.path));
}

// Version history without the heavy columns.
async function listSummaries(assetId: string) {
  return db
    .select({
      id: contentAssetVersions.id,
      version: contentAssetVersions.version,
      patchId: contentAssetVersions.patchId,
      createdBy: contentAssetVersions.createdBy,
      createdAt: contentAssetVersions.createdAt,
    })
    .from(contentAssetVersions)
    .where(eq(contentAssetVersions.assetId, assetId))
    .orderBy(desc(contentAssetVersions.version));
}

// Work orders awaiting a decision, with the current version's check results.
async function listReviewQueue(projectId: string) {
  return db
    .select({
      assetId: contentAssets.id,
      title: contentAssets.title,
      targetUrl: contentAssets.targetUrl,
      language: contentAssets.language,
      pageAction: contentAssets.pageAction,
      status: contentAssets.status,
      currentVersion: contentAssets.currentVersion,
      updatedAt: contentAssets.updatedAt,
      versionId: contentAssetVersions.id,
      checksReport: contentAssetVersions.checksReport,
    })
    .from(contentAssets)
    .innerJoin(
      contentAssetVersions,
      and(
        eq(contentAssetVersions.assetId, contentAssets.id),
        eq(contentAssetVersions.version, contentAssets.currentVersion),
      ),
    )
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        inArray(contentAssets.status, ["qa_review", "ready_to_publish"]),
      ),
    )
    .orderBy(desc(contentAssets.updatedAt));
}

export const VersionsRepository = {
  listReviewQueue,
  create,
  getById,
  getByNumber,
  listFiles,
  listSummaries,
};
