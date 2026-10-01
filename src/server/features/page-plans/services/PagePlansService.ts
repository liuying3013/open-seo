import { WORK_ORDER_ACTIONS, normalizePageUrl } from "@/shared/pagePlans";
import type { PagePlanItemInput } from "@/types/schemas/pagePlans";
import { PagePlanError } from "../pagePlanErrors";
import { PagePlansRepository } from "../repositories/PagePlansRepository";
import { SitePagesRepository } from "../repositories/SitePagesRepository";
import { getProjectSiteDomain } from "./SitePagesService";

async function getPlan(projectId: string, period: string) {
  const plan = await PagePlansRepository.getByPeriod(projectId, period);
  if (!plan) return null;
  const rows = await PagePlansRepository.listItems(plan.id);
  return {
    plan,
    approvedBy: plan.approvedByUserId
      ? await PagePlansRepository.getUserLabel(plan.approvedByUserId)
      : null,
    items: rows.map((row) => ({
      ...row.item,
      clusterName: row.clusterName,
      pageTitle: row.pageTitle,
      assetStatus: row.assetStatus,
    })),
  };
}

function listPlans(projectId: string) {
  return PagePlansRepository.listByProject(projectId);
}

type DraftInput = {
  projectId: string;
  period: string;
  notes?: string;
  items: PagePlanItemInput[];
};

// Creates the draft plan for a month, or replaces the items of the existing
// draft. An approved plan is final.
async function createDraft(input: DraftInput) {
  const { projectId } = input;
  const existing = await PagePlansRepository.getByPeriod(
    projectId,
    input.period,
  );
  if (existing?.status === "approved") {
    throw new PagePlanError(
      "PLAN_NOT_EDITABLE",
      `The ${input.period} plan is already approved and cannot be changed`,
    );
  }

  const clusterIds = [
    ...new Set(input.items.flatMap((item) => item.clusterId ?? [])),
  ];
  const foundClusters = new Set(
    await SitePagesRepository.getExistingClusterIds(projectId, clusterIds),
  );
  const missingCluster = clusterIds.find((id) => !foundClusters.has(id));
  if (missingCluster) {
    throw new PagePlanError(
      "CLUSTER_NOT_FOUND",
      `Cluster ${missingCluster} does not belong to this project`,
    );
  }

  const domain = await getProjectSiteDomain(projectId);
  const pageIds = [
    ...new Set(input.items.flatMap((item) => item.sitePageId ?? [])),
  ];
  const pagesById = new Map(
    (await SitePagesRepository.getByIds(projectId, pageIds)).map((page) => [
      page.id,
      page,
    ]),
  );
  const missingPage = pageIds.find((id) => !pagesById.has(id));
  if (missingPage) {
    throw new PagePlanError(
      "SITE_PAGE_NOT_FOUND",
      `Site page ${missingPage} does not belong to this project`,
    );
  }

  // Normalize target URLs first; an item without a site page is linked to the
  // inventory row for its URL when there is one.
  const targets = input.items.map((item) => {
    const linked = item.sitePageId ? pagesById.get(item.sitePageId) : undefined;
    const targetUrl = item.targetUrl
      ? normalizePageUrl(item.targetUrl, domain)
      : (linked?.url ?? null);
    if (!targetUrl) {
      throw new PagePlanError(
        "INVALID_URL",
        item.targetUrl
          ? `Invalid targetUrl: ${item.targetUrl}`
          : "Each item needs a targetUrl or a sitePageId",
      );
    }
    return { item, linked, targetUrl };
  });
  const byUrl = new Map(
    (
      await SitePagesRepository.getByUrls(
        projectId,
        targets.map((target) => target.targetUrl),
      )
    ).map((page) => [page.url, page]),
  );

  const now = new Date().toISOString();
  const planId = await PagePlansRepository.saveDraft({
    existingPlanId: existing?.id ?? null,
    projectId,
    period: input.period,
    notes: input.notes ?? null,
    items: targets.map(({ item, linked, targetUrl }) => {
      const page = linked ?? byUrl.get(targetUrl);
      return {
        id: crypto.randomUUID(),
        clusterId: item.clusterId ?? null,
        action: item.action,
        targetUrl,
        sitePageId: page?.id ?? null,
        language: item.language ?? page?.language ?? null,
        score: item.score ?? null,
        scoreReasons: item.scoreReasons ?? null,
        confidence: item.confidence ?? null,
        estCostUsd: item.estCostUsd ?? null,
        included: item.included ?? true,
        createdAt: now,
      };
    }),
  });
  const plan = await getPlan(projectId, input.period);
  if (!plan || plan.plan.id !== planId) {
    throw new PagePlanError("PLAN_NOT_FOUND", "Plan was not saved");
  }
  return plan;
}

async function requireDraft(projectId: string, planId: string) {
  const plan = await PagePlansRepository.getById(projectId, planId);
  if (!plan) throw new PagePlanError("PLAN_NOT_FOUND", "Plan not found");
  if (plan.status !== "draft") {
    throw new PagePlanError(
      "PLAN_NOT_EDITABLE",
      `The ${plan.period} plan is ${plan.status}, not a draft, and cannot be changed`,
    );
  }
  return plan;
}

async function setIncluded(
  projectId: string,
  planId: string,
  changes: { itemId: string; included: boolean }[],
) {
  await requireDraft(projectId, planId);
  const known = new Set(
    (await PagePlansRepository.getItems(planId)).map((item) => item.id),
  );
  if (changes.some((change) => !known.has(change.itemId))) {
    throw new PagePlanError("INVALID_ITEM", "Item does not belong to the plan");
  }
  await PagePlansRepository.setIncluded(planId, changes);
}

// Approval is a human decision: the caller must pass the signed-in web user.
// Included new/update/add_section/merge items become page work orders.
async function approve(input: {
  projectId: string;
  planId: string;
  userId: string;
}) {
  if (!input.userId) {
    throw new PagePlanError(
      "LOGIN_REQUIRED",
      "Only a signed-in user can approve a plan",
    );
  }
  const plan = await requireDraft(input.projectId, input.planId);
  const included = (await PagePlansRepository.getItems(plan.id)).filter(
    (item) => item.included && WORK_ORDER_ACTIONS.includes(item.action),
  );
  const workOrders = included.flatMap((item) =>
    item.clusterId ? [{ ...item, clusterId: item.clusterId }] : [],
  );
  if (workOrders.length !== included.length) {
    const urls = included
      .filter((item) => !item.clusterId)
      .map((item) => item.targetUrl);
    throw new PagePlanError(
      "INVALID_ITEM",
      `Items need a cluster to become work orders: ${urls.join(", ")}`,
    );
  }

  const now = new Date().toISOString();
  const assets = workOrders.map((item) => ({
    itemId: item.id,
    asset: {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      clusterId: item.clusterId,
      platform: "money_site",
      targetUrl: item.targetUrl,
      status: "planned" as const,
      createdAt: now,
      updatedAt: now,
      // TODO(page work orders): also write language (item.language),
      // page_action (item.action) and site_page_id (item.sitePageId) once
      // content_assets has those columns.
    },
  }));
  const approvedAt = await PagePlansRepository.approve({
    planId: plan.id,
    userId: input.userId,
    assets,
  });
  return {
    planId: plan.id,
    approvedAt,
    assets: assets.map(({ itemId, asset }) => ({ itemId, assetId: asset.id })),
  };
}

export const PagePlansService = {
  getPlan,
  listPlans,
  createDraft,
  setIncluded,
  approve,
} as const;
