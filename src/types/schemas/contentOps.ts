import { z } from "zod";

const platformVerdictSchema = z.enum(["DEPLOY", "TEST", "HOLD", "SKIP"]);

export const contentOpsProjectSchema = z.object({
  projectId: z.string().min(1),
});

export const contentOpsClusterSchema = z.object({
  projectId: z.string().min(1),
  clusterId: z.string().min(1),
});

export const contentOpsReviewDecisionSchema = z.object({
  projectId: z.string().min(1),
  decisionId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  moneySitePageType: z.string().optional(),
  platformVerdicts: z.record(z.string(), platformVerdictSchema).optional(),
  reason: z.string().max(500).optional(),
});

export const contentOpsApprovePackSchema = z.object({
  projectId: z.string().min(1),
  packId: z.string().min(1),
});
