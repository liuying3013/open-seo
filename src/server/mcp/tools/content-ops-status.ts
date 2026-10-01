import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { AppError } from "@/server/lib/errors";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { ClustersRepository } from "@/server/features/content-ops/repositories/ClustersRepository";
import { DecisionLogRepository } from "@/server/features/content-ops/repositories/DecisionLogRepository";
import { DecisionsRepository } from "@/server/features/content-ops/repositories/DecisionsRepository";
import { AssetsRepository } from "@/server/features/content-ops/repositories/AssetsRepository";
import { SerpRepository } from "@/server/features/content-ops/repositories/SerpRepository";
import { EvidencePacksRepository } from "@/server/features/content-ops/repositories/EvidencePacksRepository";
import { formatBudgetUsage } from "@/server/features/content-ops/rules/scoringRules";
import { BudgetService } from "@/server/features/content-ops/services/BudgetService";

// Observe/prioritize tools for the content-ops agent loop. Free, read-only.

export const getContentOpsStatusTool = {
  name: "get_content_ops_status",
  config: {
    title: "Content-ops pipeline status",
    description:
      "Overview of the content-ops pipeline for a project: cluster counts by status and today's budget usage. Free. Call this FIRST in every content-ops session (the OBSERVE step).",
    inputSchema: { projectId: projectIdSchema },
    outputSchema: z.looseObject({
      clusterCounts: z.record(z.string(), z.number()),
      budget: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const [counts, budget] = await Promise.all([
      ClustersRepository.countByStatus(args.projectId),
      BudgetService.getToday(args.projectId),
    ]);
    const countText =
      Object.entries(counts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(", ") || "no clusters yet";
    const budgetText = Object.entries(budget.usage)
      .map(
        ([kind, { used, limit }]) =>
          `${kind} ${formatBudgetUsage(used, limit)}`,
      )
      .join(", ");
    return mcpResponse({
      text: `Clusters — ${countText}.\nBudget today (${budget.date}) — ${budgetText}.`,
      structuredContent: { clusterCounts: counts, budget },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};

const nextActionsInput = {
  projectId: projectIdSchema,
  limit: z.number().int().min(1).max(50).default(10).optional(),
} as const;

/** What tool advances a cluster from each status. */
const NEXT_TOOL_BY_STATUS: Record<string, string> = {
  new: "pre_score_cluster",
  pre_scored: "fetch_cluster_serps",
  serp_pending: "fetch_cluster_serps (previous fetch incomplete)",
  serp_ready: "analyze_cluster, then score_cluster",
  scored:
    "decide_deployment (or review the open proposal with review_decision)",
  decided: "build_evidence_pack / generate_brief for planned assets",
};

export const getNextActionsTool = {
  name: "get_next_actions",
  config: {
    title: "Next content-ops actions",
    description:
      "Prioritized list of clusters that can advance, with the tool to call for each (the PRIORITIZE step). Ordered by business value where scored. Free.",
    inputSchema: nextActionsInput,
    outputSchema: z.looseObject({
      actions: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; limit?: number }, context) => {
      const clusters = await ClustersRepository.listByProject(args.projectId);
      const actionable = clusters
        .filter((cluster) => NEXT_TOOL_BY_STATUS[cluster.status])
        .slice(0, args.limit ?? 10);
      const lines = actionable.map(
        (cluster) =>
          `- ${cluster.name} [${cluster.id}] (${cluster.status}${cluster.businessValueScore !== null ? `, value ${cluster.businessValueScore}` : ""}${cluster.entityCategory === "AMBIGUOUS" ? ", AMBIGUOUS entity" : ""}) -> ${NEXT_TOOL_BY_STATUS[cluster.status]}`,
      );
      return mcpResponse({
        text:
          lines.length > 0
            ? `Actionable clusters (highest value first):\n${lines.join("\n")}`
            : "No actionable clusters. Import candidate keywords (save_candidate_keywords) and run propose_clusters, or review pending decisions in the UI.",
        structuredContent: {
          actions: actionable.map((cluster) => ({
            clusterId: cluster.id,
            name: cluster.name,
            status: cluster.status,
            businessValueScore: cluster.businessValueScore,
            nextTool: NEXT_TOOL_BY_STATUS[cluster.status],
          })),
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

export const getClusterTool = {
  name: "get_cluster",
  config: {
    title: "Get cluster detail",
    description:
      "Full detail for one cluster: keywords, scores, latest SERP snapshot summary, decisions, evidence pack status, assets, and recent decision log. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      cluster: looseObjectOutputSchema,
      keywords: z.array(looseObjectOutputSchema),
      snapshots: z.array(looseObjectOutputSchema),
      decisions: z.array(looseObjectOutputSchema),
      evidencePack: looseObjectOutputSchema.nullable(),
      assets: z.array(looseObjectOutputSchema),
      recentLog: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; clusterId: string }, context) => {
      const cluster = await ClustersRepository.getById(
        args.projectId,
        args.clusterId,
      );
      if (!cluster) {
        throw new AppError("NOT_FOUND", `Cluster ${args.clusterId} not found.`);
      }
      const [keywords, snapshots, decisions, assets, pack, log] =
        await Promise.all([
          ClustersRepository.getKeywords(args.clusterId),
          SerpRepository.getLatestForCluster(args.clusterId),
          DecisionsRepository.listByCluster(args.clusterId),
          AssetsRepository.listByCluster(args.clusterId),
          EvidencePacksRepository.getLatestForCluster(args.clusterId),
          DecisionLogRepository.listByCluster(args.clusterId, 10),
        ]);
      const structured = {
        cluster,
        keywords: keywords.map((k) => ({
          keyword: k.keyword,
          isRepresentative: k.isRepresentative,
          searchVolume: k.searchVolume,
          source: k.source,
        })),
        snapshots: snapshots.map((group) => ({
          id: group.snapshot.id,
          keyword: group.snapshot.keyword,
          device: group.snapshot.device,
          fetchedAt: group.snapshot.fetchedAt,
          resultCount: group.results.length,
          topResults: group.results.slice(0, 10).map((r) => ({
            rank: r.rank,
            url: r.url,
            resultType: r.resultType,
            platform: r.platform,
            contentType: r.contentType,
          })),
        })),
        decisions: decisions.map((d) => ({
          id: d.id,
          status: d.status,
          moneySitePageType: d.moneySitePageType,
          reasonSummary: d.reasonSummary,
          createdAt: d.createdAt,
        })),
        evidencePack: pack
          ? { id: pack.id, version: pack.version, status: pack.status }
          : null,
        assets: assets.map((a) => ({
          id: a.id,
          platform: a.platform,
          status: a.status,
          angle: a.angle,
          title: a.title,
        })),
        recentLog: log.map((entry) => ({
          decisionType: entry.decisionType,
          reasonSummary: entry.reasonSummary,
          createdAt: entry.createdAt,
          createdBy: entry.createdBy,
        })),
      };
      return mcpResponse({
        text: JSON.stringify(structured, null, 2),
        structuredContent: structured,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};
