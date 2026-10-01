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
import { EvidencePackService } from "@/server/features/content-ops/services/EvidencePackService";
import { BriefService } from "@/server/features/content-ops/services/BriefService";

export const buildEvidencePackTool = {
  name: "build_evidence_pack",
  config: {
    title: "Build evidence pack",
    description:
      "Generate the cluster's MASTER EVIDENCE PACK (versioned) from stored evidence only: the ranking-page bodies read by read_ranking_pages, SERP rows, PAA questions, related searches, the linked offer, and project memory. REQUIRES read_ranking_pages to have run for this cluster — a pack built from titles and snippets alone is a deployment note, not a writing brief, so the tool refuses. Facts are source-cited and must come from a page body, the offer or project context; pages that could not be opened land in openQuestions. Returns a DRAFT — review it with the user (especially openQuestions), then approve_evidence_pack. Uses 1 LLM budget unit.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      packId: z.string(),
      version: z.number(),
      content: looseObjectOutputSchema,
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
        await EvidencePackService.buildPack(args).catch(rethrowAsAppError);
      return mcpResponse({
        text: `Evidence pack v${result.version} (${result.packId}) drafted: ${result.content.verifiedFacts.length} verified facts, ${result.content.openQuestions.length} open questions.\n\nOpen questions for the user:\n${result.content.openQuestions.map((q) => `- ${q}`).join("\n") || "(none)"}\n\nReview the pack with the user, then call approve_evidence_pack.`,
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

export const approveEvidencePackTool = {
  name: "approve_evidence_pack",
  config: {
    title: "Approve evidence pack",
    description:
      "Approve an evidence pack ON THE USER'S EXPLICIT INSTRUCTION — the approved pack becomes the only source briefs may draw facts from. Free.",
    inputSchema: {
      projectId: projectIdSchema,
      packId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      packId: z.string(),
      status: z.literal("approved"),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; packId: string }, context) => {
      const result =
        await EvidencePackService.approvePack(args).catch(rethrowAsAppError);
      return mcpResponse({
        text: `Evidence pack approved. Next: generate_brief for each planned asset.`,
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

export const generateBriefTool = {
  name: "generate_brief",
  config: {
    title: "Generate content brief",
    description:
      "Generate one platform-native content brief for a planned asset from the cluster's APPROVED evidence pack. Enforces a differentiated angle vs sibling assets (no cross-platform copies). Consumes 1 LLM budget unit; brief count is uncapped. When every asset is brief_ready the cluster reaches BRIEF_READY (MVP milestone).",
    inputSchema: {
      projectId: projectIdSchema,
      assetId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      assetId: z.string(),
      platform: z.string(),
      angle: z.string(),
      title: z.string(),
      brief: z.string(),
      clusterBriefReady: z.boolean(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; assetId: string }, context) => {
      const result =
        await BriefService.generateBrief(args).catch(rethrowAsAppError);
      return mcpResponse({
        text: `Brief ready for ${result.platform}: "${result.title}"\nAngle: ${result.angle}\n\n${result.brief}\n\n${result.clusterBriefReady ? "All assets brief-ready — cluster is BRIEF_READY." : "More assets still need briefs (get_cluster shows which)."}`,
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
