import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { contentAssets } from "@/db/schema";
import type { AssetStatus } from "../stateMachine";

export type NewAsset = {
  projectId: string;
  clusterId: string;
  decisionId: string | null;
  platform: string;
  assetType: string | null;
  brandMentionMode: string | null;
};

async function insertMany(assets: NewAsset[]): Promise<string[]> {
  const now = new Date().toISOString();
  const rows = assets.map((asset) => ({
    id: crypto.randomUUID(),
    status: "planned" as const,
    createdAt: now,
    updatedAt: now,
    ...asset,
  }));
  await executeInBatches(rows, (tx, row) =>
    tx.insert(contentAssets).values(row).onConflictDoNothing(),
  );
  const decisionIds = [
    ...new Set(
      rows
        .map((row) => row.decisionId)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (decisionIds.length !== 1) return rows.map((row) => row.id);
  const persisted = await listByDecision(decisionIds[0]);
  return persisted.map((row) => row.id);
}

async function getById(projectId: string, assetId: string) {
  const rows = await db
    .select()
    .from(contentAssets)
    .where(
      and(
        eq(contentAssets.id, assetId),
        eq(contentAssets.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listByCluster(clusterId: string) {
  return db
    .select()
    .from(contentAssets)
    .where(eq(contentAssets.clusterId, clusterId))
    .orderBy(asc(contentAssets.platform));
}

async function listByDecision(decisionId: string) {
  return db
    .select()
    .from(contentAssets)
    .where(eq(contentAssets.decisionId, decisionId))
    .orderBy(asc(contentAssets.platform));
}

async function setBriefReady(
  projectId: string,
  assetId: string,
  from: AssetStatus,
  fields: {
    angle: string | null;
    title: string | null;
    brief: string | null;
  },
): Promise<boolean> {
  const updated = await db
    .update(contentAssets)
    .set({
      ...fields,
      status: "brief_ready",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(contentAssets.projectId, projectId),
        eq(contentAssets.id, assetId),
        eq(contentAssets.status, from),
      ),
    )
    .returning({ id: contentAssets.id });
  return updated.length > 0;
}

/**
 * Persist a draft (and optionally its QA report) and move the asset's status.
 * Draft and brief are separate columns on purpose: a redraft must never
 * destroy the instructions it was written from.
 */
async function saveDraft(input: {
  projectId: string;
  assetId: string;
  draft: string;
  status: "drafted" | "qa_review" | "ready_to_publish";
  qaReport?: string | null;
  expected?: { draft: string | null; status: AssetStatus; updatedAt: string };
}) {
  const updated = await db
    .update(contentAssets)
    .set({
      draft: input.draft,
      status: input.status,
      updatedAt: new Date().toISOString(),
      ...(input.qaReport === undefined ? {} : { qaReport: input.qaReport }),
    })
    .where(
      and(
        eq(contentAssets.id, input.assetId),
        eq(contentAssets.projectId, input.projectId),
        ...(input.expected
          ? [
              input.expected.draft === null
                ? isNull(contentAssets.draft)
                : eq(contentAssets.draft, input.expected.draft),
              eq(contentAssets.status, input.expected.status),
              eq(contentAssets.updatedAt, input.expected.updatedAt),
            ]
          : []),
      ),
    )
    .returning({ id: contentAssets.id });
  return updated.length > 0;
}

export const AssetsRepository = {
  saveDraft,
  insertMany,
  getById,
  listByCluster,
  listByDecision,
  setBriefReady,
};
