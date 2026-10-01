import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  clusters,
  contentAssets,
  pagePlanItems,
  pagePlans,
  sitePages,
  user,
} from "@/db/schema";

type NewPagePlanItem = typeof pagePlanItems.$inferInsert;
type NewAsset = typeof contentAssets.$inferInsert;

async function getByPeriod(projectId: string, period: string) {
  const [row] = await db
    .select()
    .from(pagePlans)
    .where(
      and(eq(pagePlans.projectId, projectId), eq(pagePlans.period, period)),
    )
    .limit(1);
  return row ?? null;
}

async function getById(projectId: string, planId: string) {
  const [row] = await db
    .select()
    .from(pagePlans)
    .where(and(eq(pagePlans.projectId, projectId), eq(pagePlans.id, planId)))
    .limit(1);
  return row ?? null;
}

async function getUserLabel(userId: string) {
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row ? row.name || row.email : null;
}

async function listByProject(projectId: string) {
  return db
    .select()
    .from(pagePlans)
    .where(eq(pagePlans.projectId, projectId))
    .orderBy(desc(pagePlans.period));
}

// Items with the cluster, target page and work order they refer to.
async function listItems(planId: string) {
  return db
    .select({
      item: pagePlanItems,
      clusterName: clusters.name,
      pageTitle: sitePages.title,
      assetStatus: contentAssets.status,
    })
    .from(pagePlanItems)
    .leftJoin(clusters, eq(clusters.id, pagePlanItems.clusterId))
    .leftJoin(sitePages, eq(sitePages.id, pagePlanItems.sitePageId))
    .leftJoin(contentAssets, eq(contentAssets.id, pagePlanItems.assetId))
    .where(eq(pagePlanItems.planId, planId))
    .orderBy(desc(pagePlanItems.score), asc(pagePlanItems.createdAt));
}

async function getItems(planId: string) {
  return db
    .select()
    .from(pagePlanItems)
    .where(eq(pagePlanItems.planId, planId));
}

// Creates the plan for a period, or resets an existing draft: the plan row is
// updated and its items replaced, atomically.
async function saveDraft(input: {
  existingPlanId: string | null;
  projectId: string;
  period: string;
  notes: string | null;
  items: Omit<NewPagePlanItem, "planId">[];
}) {
  const planId = input.existingPlanId ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await runBatch((tx) => [
    input.existingPlanId
      ? tx
          .update(pagePlans)
          .set({ status: "draft", notes: input.notes, updatedAt: now })
          .where(eq(pagePlans.id, planId))
      : tx.insert(pagePlans).values({
          id: planId,
          projectId: input.projectId,
          period: input.period,
          notes: input.notes,
          createdAt: now,
          updatedAt: now,
        }),
    tx.delete(pagePlanItems).where(eq(pagePlanItems.planId, planId)),
    ...input.items.map((item) =>
      tx.insert(pagePlanItems).values({ ...item, planId }),
    ),
  ]);
  return planId;
}

async function setIncluded(
  planId: string,
  changes: { itemId: string; included: boolean }[],
) {
  await runBatch((tx) =>
    changes.map(({ itemId, included }) =>
      tx
        .update(pagePlanItems)
        .set({ included })
        .where(
          and(eq(pagePlanItems.id, itemId), eq(pagePlanItems.planId, planId)),
        ),
    ),
  );
}

// Approves the plan and creates its work orders in one transaction.
async function approve(input: {
  planId: string;
  userId: string;
  assets: { itemId: string; asset: NewAsset }[];
}) {
  const now = new Date().toISOString();
  await runBatch((tx) => [
    ...input.assets.map(({ asset }) => tx.insert(contentAssets).values(asset)),
    ...input.assets.map(({ itemId, asset }) =>
      tx
        .update(pagePlanItems)
        .set({ assetId: asset.id })
        .where(eq(pagePlanItems.id, itemId)),
    ),
    tx
      .update(pagePlans)
      .set({
        status: "approved",
        approvedByUserId: input.userId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(pagePlans.id, input.planId)),
  ]);
  return now;
}

export const PagePlansRepository = {
  getByPeriod,
  getById,
  getUserLabel,
  listByProject,
  listItems,
  getItems,
  saveDraft,
  setIncluded,
  approve,
} as const;
