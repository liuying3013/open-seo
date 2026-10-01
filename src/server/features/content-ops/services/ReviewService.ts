import { z } from "zod";
import { ContentOpsError } from "../contentOpsErrors";
import {
  RULE_VERSION,
  THIRD_PARTY_PLATFORMS,
  type ThirdPartyPlatform,
} from "../rules/scoringRules";
import type { PlatformPlanEntry } from "../rules/computeScores";
import { assertClusterTransition } from "../stateMachine";
import {
  AssetsRepository,
  type NewAsset,
} from "../repositories/AssetsRepository";
import { ClustersRepository } from "../repositories/ClustersRepository";
import { DecisionLogRepository } from "../repositories/DecisionLogRepository";
import { DecisionsRepository } from "../repositories/DecisionsRepository";

// Approval is the human gate of the pipeline: only an approved decision
// creates content_assets rows, and every approval/rejection is logged. Edits
// at approval time re-attribute the decision to the user.

const platformPlanSchema = z.array(
  z.object({
    platform: z.enum(THIRD_PARTY_PLATFORMS),
    verdict: z.enum(["DEPLOY", "TEST", "HOLD", "SKIP"]),
    score: z.number(),
    subscores: z.record(z.string(), z.number()),
  }),
);

/** Default brand-mention mode per platform (spec §25: always disclosed). */
const BRAND_MENTION_DEFAULTS: Record<string, string> = {
  medium: "author_attribution",
  youtube: "author_attribution",
  pinterest: "resource",
  linkedin: "author_attribution",
  reddit: "experience",
  quora: "experience",
  pdf: "resource",
};

/** Asset type per platform; money_site uses the decided page type. */
const ASSET_TYPE_BY_PLATFORM: Record<string, string> = {
  medium: "article",
  youtube: "video_script",
  pinterest: "pin",
  linkedin: "post",
  reddit: "thread",
  quora: "answer",
  pdf: "document",
  facebook: "post",
  instagram: "visual_post",
};

async function reviewDecision(input: {
  projectId: string;
  decisionId: string;
  action: "approve" | "reject";
  edits?: {
    moneySitePageType?: string;
    platformVerdicts?: Partial<
      Record<ThirdPartyPlatform, "DEPLOY" | "TEST" | "HOLD" | "SKIP">
    >;
  };
  reason?: string;
}) {
  let decision = await DecisionsRepository.getById(
    input.projectId,
    input.decisionId,
  );
  if (!decision) {
    throw new ContentOpsError("DECISION_NOT_FOUND", "Decision not found.");
  }
  if (input.action === "reject") {
    if (decision.status === "rejected") {
      return { status: "rejected" as const, assetIds: [] };
    }
    if (decision.status !== "proposed") {
      throw new ContentOpsError(
        "DECISION_NOT_FOUND",
        `Decision is ${decision.status}; only proposed decisions can be rejected.`,
      );
    }
    const rejected = await DecisionsRepository.transitionStatus(
      input.projectId,
      input.decisionId,
      "proposed",
      { status: "rejected" },
    );
    if (!rejected) {
      const current = await DecisionsRepository.getById(
        input.projectId,
        input.decisionId,
      );
      if (current?.status === "rejected") {
        return { status: "rejected" as const, assetIds: [] };
      }
      throw new ContentOpsError(
        "DECISION_NOT_FOUND",
        "Decision changed while it was being rejected; refresh and try again.",
      );
    }
    await DecisionLogRepository.append({
      projectId: input.projectId,
      clusterId: decision.clusterId,
      decisionType: "platform_plan",
      decision: JSON.stringify({
        decisionId: input.decisionId,
        action: "reject",
      }),
      reasonSummary: input.reason ?? "Rejected by reviewer.",
      ruleVersion: RULE_VERSION,
      createdBy: "user",
    });
    return { status: "rejected" as const, assetIds: [] };
  }

  if (decision.status !== "proposed" && decision.status !== "approved") {
    throw new ContentOpsError(
      "DECISION_NOT_FOUND",
      `Decision is ${decision.status}; only proposed decisions can be approved.`,
    );
  }

  // Apply reviewer edits (verdict overrides / page type) before materializing.
  const plan = platformPlanSchema.parse(
    JSON.parse(decision.platformPlan ?? "[]"),
  );
  const edited = Boolean(
    input.edits?.moneySitePageType ||
    Object.keys(input.edits?.platformVerdicts ?? {}).length > 0,
  );
  const pageType = input.edits?.moneySitePageType ?? decision.moneySitePageType;
  const finalPlan: PlatformPlanEntry[] = plan.map((entry) => ({
    ...entry,
    verdict: input.edits?.platformVerdicts?.[entry.platform] ?? entry.verdict,
  }));

  let wonApproval = false;
  if (decision.status === "proposed") {
    wonApproval = await DecisionsRepository.transitionStatus(
      input.projectId,
      input.decisionId,
      "proposed",
      {
        status: "approved",
        approvedAt: new Date().toISOString(),
        moneySitePageType: pageType ?? undefined,
        platformPlan: JSON.stringify(finalPlan),
        ...(edited && { decidedBy: "user" as const }),
      },
    );
    decision = await DecisionsRepository.getById(
      input.projectId,
      input.decisionId,
    );
    if (!decision || decision.status !== "approved") {
      throw new ContentOpsError(
        "DECISION_NOT_FOUND",
        "Decision changed while it was being approved; refresh and try again.",
      );
    }
  }

  // Always materialize from the persisted winning plan. A retried approval can
  // therefore repair a crash after the status transition, while the unique
  // decision/platform index prevents concurrent duplicate assets.
  const persistedPlan = platformPlanSchema.parse(
    JSON.parse(decision.platformPlan ?? "[]"),
  );
  const persistedPageType = decision.moneySitePageType;

  const assets: NewAsset[] = [];
  if (persistedPageType && persistedPageType !== "none") {
    assets.push({
      projectId: input.projectId,
      clusterId: decision.clusterId,
      decisionId: input.decisionId,
      platform: "money_site",
      assetType: persistedPageType,
      brandMentionMode: null,
    });
  }
  for (const entry of persistedPlan) {
    if (entry.verdict !== "DEPLOY" && entry.verdict !== "TEST") continue;
    assets.push({
      projectId: input.projectId,
      clusterId: decision.clusterId,
      decisionId: input.decisionId,
      platform: entry.platform,
      assetType: ASSET_TYPE_BY_PLATFORM[entry.platform] ?? null,
      brandMentionMode: BRAND_MENTION_DEFAULTS[entry.platform] ?? null,
    });
  }
  const assetIds = await AssetsRepository.insertMany(assets);

  const cluster = await ClustersRepository.getById(
    input.projectId,
    decision.clusterId,
  );
  if (cluster && cluster.status === "scored") {
    assertClusterTransition(cluster.status, "decided");
    await ClustersRepository.transitionStatus(
      input.projectId,
      decision.clusterId,
      "scored",
      "decided",
    );
  }

  if (wonApproval) {
    await DecisionLogRepository.append({
      projectId: input.projectId,
      clusterId: decision.clusterId,
      decisionType: "platform_plan",
      inputSnapshot: JSON.stringify({ edits: input.edits ?? null }),
      decision: JSON.stringify({
        decisionId: input.decisionId,
        action: "approve",
        pageType: persistedPageType,
        finalPlan: persistedPlan.map((entry) => ({
          platform: entry.platform,
          verdict: entry.verdict,
        })),
        assetIds,
      }),
      reasonSummary:
        input.reason ??
        (edited ? "Approved with reviewer edits." : "Approved as proposed."),
      ruleVersion: RULE_VERSION,
      createdBy: "user",
    });
  }

  return { status: "approved" as const, assetIds };
}

export const ReviewService = {
  reviewDecision,
};
