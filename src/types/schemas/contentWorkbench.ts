import { z } from "zod";
import { contentOpsClusterSchema, contentOpsProjectSchema } from "./contentOps";
import { USER_JOBS } from "@/server/features/content-ops/rules/scoringRules";
import { draftSchema } from "@/server/features/content-factory/prompts/generateDraft";

export const workbenchTopicSchema = contentOpsProjectSchema.extend({
  name: z.string().trim().min(1).max(160),
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  offerId: z.string().min(1).optional(),
  primaryEntity: z.string().trim().min(1).max(160),
  entityCategory: z.string().trim().max(160).optional(),
  userJob: z.enum(USER_JOBS),
});

export const workbenchOfferSchema = contentOpsProjectSchema.extend({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10000),
  marginTier: z.enum(["high", "mid", "low"]),
  readiness: z.enum(["ready", "partial", "none"]),
  marketPriority: z.number().int().min(1).max(5),
});

export const workbenchClusterActionSchema = z.discriminatedUnion("action", [
  contentOpsClusterSchema.extend({
    action: z.literal("pre_score"),
    businessFit: z.number().min(0).max(100),
    reason: z.string().trim().min(1).max(500),
  }),
  contentOpsClusterSchema.extend({
    action: z.literal("fetch_serps"),
    approvedRequestKey: z.string().min(1),
    confirmed: z.literal(true),
  }),
  contentOpsClusterSchema.extend({ action: z.literal("analyze") }),
  contentOpsClusterSchema.extend({
    action: z.literal("score"),
    offerId: z.string().min(1).optional(),
    purchaseProximity: z.number().min(0).max(100),
    conversionReadiness: z.number().min(0).max(100),
    coreRelevance: z.number().min(0).max(100),
  }),
  contentOpsClusterSchema.extend({ action: z.literal("decide") }),
  contentOpsClusterSchema.extend({ action: z.literal("read_pages") }),
  contentOpsClusterSchema.extend({ action: z.literal("build_pack") }),
]);

const workbenchAssetSchema = contentOpsProjectSchema.extend({
  assetId: z.string().min(1),
});
export const workbenchAssetActionSchema = workbenchAssetSchema.extend({
  action: z.enum(["brief", "draft", "qa"]),
  confirmed: z.literal(true),
});
export const workbenchSaveDraftSchema = workbenchAssetSchema.extend({
  expectedDraft: z.string().max(300000),
  draft: draftSchema.extend({
    title: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(200000),
    metaDescription: z.string().max(2000),
    slug: z.string().trim().min(1).max(300),
  }),
});
export type WorkbenchClusterAction = z.infer<
  typeof workbenchClusterActionSchema
>;
