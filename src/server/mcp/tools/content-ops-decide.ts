import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { rethrowAsAppError } from "@/server/features/content-ops/contentOpsErrors";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { THIRD_PARTY_PLATFORMS } from "@/server/features/content-ops/rules/scoringRules";
import { ScoreService } from "@/server/features/content-ops/services/ScoreService";
import { DecideService } from "@/server/features/content-ops/services/DecideService";
import { ReviewService } from "@/server/features/content-ops/services/ReviewService";

const judgment = (what: string) =>
  z.number().min(0).max(100).describe(`0-100 judgment: ${what}`);

type ScoreArgs = {
  projectId: string;
  clusterId: string;
  offerId?: string;
  purchaseProximity: number;
  conversionReadiness: number;
  coreRelevance: number;
};

export const scoreClusterTool = {
  name: "score_cluster",
  config: {
    title: "Score cluster business value",
    description:
      "Compute the cluster's business value (0-100) with versioned weights: offer facts (margin/readiness/priority) + your three judgment inputs + log-scaled volume (max 5 pts). Read project context and the offer before judging. Blocked while the entity is AMBIGUOUS. Free; logged with the full breakdown.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
      offerId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Offer this cluster serves (from list_offers). Sets or replaces the cluster's offer link; without one, supplier/margin/priority score 0.",
        ),
      purchaseProximity: judgment("how close to a purchase the searcher is"),
      conversionReadiness: judgment(
        "a landing page / WhatsApp / RFQ path exists and fits this cluster",
      ),
      coreRelevance: judgment(
        "how central this cluster is to the core business",
      ),
    },
    outputSchema: z.looseObject({
      score: z.number(),
      breakdown: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ScoreArgs, context) => {
    const { score, breakdown } = await ScoreService.scoreBusinessValue({
      projectId: args.projectId,
      clusterId: args.clusterId,
      offerId: args.offerId,
      agent: {
        purchaseProximity: args.purchaseProximity,
        conversionReadiness: args.conversionReadiness,
        coreRelevance: args.coreRelevance,
      },
      createdBy: "agent",
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text: `Business value: ${score}/100. Next: decide_deployment.`,
      structuredContent: { score, breakdown },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};

type DecideArgs = {
  projectId: string;
  clusterId: string;
  brandNaturalness?: Partial<
    Record<(typeof THIRD_PARTY_PLATFORMS)[number], number>
  >;
  evidenceReadiness?: number;
};

export const decideDeploymentTool = {
  name: "decide_deployment",
  config: {
    title: "Decide deployment plan",
    description:
      "Generate the DETERMINISTIC deployment proposal for a scored cluster: money-site page type from SERP format rules, plus per-platform DEPLOY/TEST/HOLD/SKIP from versioned suitability scoring. Off-target entities are forced to SKIP. Creates a PROPOSED decision — nothing is materialized until review_decision approves it. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
      brandNaturalness: z
        .record(z.enum(THIRD_PARTY_PLATFORMS), z.number().min(0).max(100))
        .optional()
        .describe(
          "0-100 per platform: how naturally the brand can appear there (default 50)",
        ),
      evidenceReadiness: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .describe("0-100: how much original evidence exists (default 50)"),
    },
    outputSchema: z.looseObject({
      decisionId: z.string(),
      pageType: z.string(),
      pageTypeReason: z.string(),
      platformPlan: z.array(looseObjectOutputSchema),
      reasonSummary: z.string(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: DecideArgs, context) => {
    const result =
      await DecideService.decideDeployment(args).catch(rethrowAsAppError);
    const planText = result.platformPlan
      .map((entry) => `${entry.platform}: ${entry.verdict} (${entry.score})`)
      .join(", ");
    return mcpResponse({
      text: `Proposed decision ${result.decisionId}\nMoney site: ${result.pageType} — ${result.pageTypeReason}\nPlatforms: ${planText}\n\nPresent this to the user, then call review_decision (approve/reject, optionally with edits).`,
      structuredContent: result,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};

type ReviewArgs = {
  projectId: string;
  decisionId: string;
  action: "approve" | "reject";
  moneySitePageType?: string;
  platformVerdicts?: Partial<
    Record<
      (typeof THIRD_PARTY_PLATFORMS)[number],
      "DEPLOY" | "TEST" | "HOLD" | "SKIP"
    >
  >;
  reason?: string;
};

export const reviewDecisionTool = {
  name: "review_decision",
  config: {
    title: "Review a deployment decision",
    description:
      "Approve or reject a proposed deployment decision ON THE USER'S EXPLICIT INSTRUCTION — never call this without the user confirming in chat. Approval creates the planned content assets (money site + DEPLOY/TEST platforms). Optional edits override page type or platform verdicts and re-attribute the decision to the user. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      decisionId: z.string().min(1),
      action: z.enum(["approve", "reject"]),
      moneySitePageType: z.string().optional(),
      platformVerdicts: z
        .record(
          z.enum(THIRD_PARTY_PLATFORMS),
          z.enum(["DEPLOY", "TEST", "HOLD", "SKIP"]),
        )
        .optional(),
      reason: z.string().max(500).optional(),
    },
    outputSchema: z.looseObject({
      status: z.enum(["approved", "rejected"]),
      assetIds: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: ReviewArgs, context) => {
    const result = await ReviewService.reviewDecision({
      projectId: args.projectId,
      decisionId: args.decisionId,
      action: args.action,
      edits: {
        moneySitePageType: args.moneySitePageType,
        platformVerdicts: args.platformVerdicts,
      },
      reason: args.reason,
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text:
        result.status === "approved"
          ? `Approved. Created ${result.assetIds.length} planned asset(s). Next: build_evidence_pack.`
          : "Rejected. Re-run decide_deployment after adjusting inputs, or archive the cluster.",
      structuredContent: result,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};
