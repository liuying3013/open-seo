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
import { USER_JOBS } from "@/server/features/content-ops/rules/scoringRules";
import { ClusteringService } from "@/server/features/content-ops/services/ClusteringService";
import { ScoreService } from "@/server/features/content-ops/services/ScoreService";

export const proposeClustersTool = {
  name: "propose_clusters",
  config: {
    title: "Propose keyword clusters",
    description:
      "LLM-propose clusters over the project's unclustered candidate keywords (entity + user job + representatives). READ-ONLY: writes nothing. Review the proposal with the user (adjust names, entities, representatives), then persist the confirmed shape with save_clusters. Uses 1 LLM budget unit.",
    inputSchema: {
      projectId: projectIdSchema,
      candidateKeywordIds: z
        .array(z.string().min(1))
        .max(500)
        .optional()
        .describe(
          "Restrict to these candidate keywords; omit for all unclustered",
        ),
    },
    outputSchema: z.looseObject({
      proposal: looseObjectOutputSchema,
      model: z.string(),
      promptVersion: z.string(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (
      args: { projectId: string; candidateKeywordIds?: string[] },
      context,
    ) => {
      const result =
        await ClusteringService.propose(args).catch(rethrowAsAppError);
      const lines = result.proposal.clusters.map(
        (cluster) =>
          `- ${cluster.name} (${cluster.userJob}${cluster.entityCategory ? `, ${cluster.entityCategory}` : ""}): ${cluster.keywords.length} kw, reps: ${cluster.representatives.join(" | ")}`,
      );
      return mcpResponse({
        text: `Proposed ${result.proposal.clusters.length} clusters over ${result.candidateCount} keywords (model ${result.model}):\n${lines.join("\n")}\nUnassigned: ${result.proposal.unassigned.length}.\n\nReview with the user, then call save_clusters with the confirmed clusters, passing model="${result.model}" and promptVersion="${result.promptVersion}".`,
        structuredContent: {
          proposal: result.proposal,
          model: result.model,
          promptVersion: result.promptVersion,
        },
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};

const saveClusterSchema = z.object({
  name: z.string().min(1).max(200),
  offerId: z.string().nullable().optional(),
  primaryEntity: z.string().nullable().optional(),
  entityCategory: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Project taxonomy category, or AMBIGUOUS to force disambiguation",
    ),
  userJob: z.enum(USER_JOBS),
  keywords: z.array(z.string().min(1)).min(1).max(100),
  representatives: z.array(z.string().min(1)).min(1).max(3),
});

type SaveClustersArgs = {
  projectId: string;
  clusters: z.infer<typeof saveClusterSchema>[];
  model?: string;
  promptVersion?: string;
};

export const saveClustersTool = {
  name: "save_clusters",
  config: {
    title: "Save confirmed clusters",
    description:
      "Persist user-confirmed clusters (from propose_clusters, possibly edited). Each keyword may belong to only one cluster — conflicts fail the whole call. Ask the user to confirm the cluster list before calling. Writes a clustering decision-log entry. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      clusters: z.array(saveClusterSchema).min(1).max(100),
      model: z.string().optional().describe("Model from propose_clusters"),
      promptVersion: z.string().optional(),
    },
    outputSchema: z.looseObject({
      clusterIds: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: SaveClustersArgs, context) => {
    const { clusterIds } = await ClusteringService.save({
      projectId: args.projectId,
      clusters: args.clusters,
      createdBy: "user",
      model: args.model ?? null,
      promptVersion: args.promptVersion ?? null,
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text: `Saved ${clusterIds.length} clusters. Next: pre_score_cluster each (or get_next_actions).`,
      structuredContent: { clusterIds },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};

type PreScoreArgs = {
  projectId: string;
  clusterId: string;
  businessFit: number;
  reason: string;
};

export const preScoreClusterTool = {
  name: "pre_score_cluster",
  config: {
    title: "Pre-score a cluster",
    description:
      "Record the pre-SERP business-fit triage (0-100) that decides whether the cluster earns a paid SERP fetch (threshold 40). Judge from keywords, offers, and project context — NOT search volume alone. Logs the judgment. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
      businessFit: z.number().min(0).max(100),
      reason: z.string().min(1).max(500),
    },
    outputSchema: z.looseObject({
      proceedToSerp: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: PreScoreArgs, context) => {
    const { proceedToSerp } = await ScoreService.preScore({
      ...args,
      createdBy: "agent",
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text: proceedToSerp
        ? `Pre-scored ${args.businessFit}/100 — proceed to fetch_cluster_serps.`
        : `Pre-scored ${args.businessFit}/100 — below the SERP-fetch threshold (40); leave on_hold or archive.`,
      structuredContent: { proceedToSerp },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};
