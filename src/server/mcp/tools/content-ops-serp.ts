import { sort } from "remeda";
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
import { SerpFetchService } from "@/server/features/content-ops/services/SerpFetchService";
import { AnalyzeService } from "@/server/features/content-ops/services/AnalyzeService";

type FetchArgs = {
  projectId: string;
  clusterId: string;
  devices?: Array<"desktop" | "mobile">;
};

export const fetchClusterSerpsTool = {
  name: "fetch_cluster_serps",
  config: {
    title: "Fetch cluster SERPs",
    description:
      "Fetch and STORE live Google SERPs (depth 20, all features) for a cluster's representative keywords. Charges credits per keyword×device and consumes serpFetches budget. Results persist as classified snapshots that scoring, decisions and evidence packs reuse — unlike get_serp_results, nothing is discarded.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
      devices: z
        .array(z.enum(["desktop", "mobile"]))
        .max(2)
        .optional()
        .describe("Default: desktop only"),
    },
    outputSchema: z.looseObject({
      snapshotIds: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: FetchArgs, context) => {
    const { snapshotIds } = await SerpFetchService.fetchClusterSerps({
      projectId: args.projectId,
      clusterId: args.clusterId,
      customer: context.billing,
      devices: args.devices,
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text: `Stored ${snapshotIds.length} SERP snapshot(s). Next: analyze_cluster.`,
      structuredContent: { snapshotIds },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};

export const analyzeClusterTool = {
  name: "analyze_cluster",
  config: {
    title: "Analyze cluster SERPs",
    description:
      "Analyze the stored SERP snapshots of a cluster: LLM-classify result formats, resolve an AMBIGUOUS entity against what actually ranks, then compute format shares, platform acceptance and the intent vector (deterministic, versioned rules). Uses 1 LLM budget unit; everything is logged.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      entityCategory: z.string().nullable(),
      formatScores: z.record(z.string(), z.number()),
      platformAcceptance: z.record(z.string(), z.number()),
      intentVector: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; clusterId: string }, context) => {
      const result =
        await AnalyzeService.analyzeCluster(args).catch(rethrowAsAppError);
      const topFormats = sort(
        Object.entries(result.formatScores),
        (a, b) => b[1] - a[1],
      )
        .slice(0, 4)
        .map(([type, share]) => `${type} ${(share * 100).toFixed(0)}%`)
        .join(", ");
      const acceptedPlatforms = Object.entries(result.platformAcceptance)
        .filter(([, share]) => share > 0.02)
        .map(([platform, share]) => `${platform} ${(share * 100).toFixed(0)}%`)
        .join(", ");
      return mcpResponse({
        text: `Entity: ${result.entityCategory ?? "(none)"}. Formats: ${topFormats || "none"}. Platform acceptance: ${acceptedPlatforms || "none in SERP"}. Next: score_cluster with your judgment inputs.`,
        structuredContent: result,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};
