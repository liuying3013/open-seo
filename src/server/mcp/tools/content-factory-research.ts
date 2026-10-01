import { z } from "zod";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { rethrowAsAppError } from "@/server/features/content-factory/contentFactoryErrors";
import { ReadPagesService } from "@/server/features/content-factory/services/ReadPagesService";
import {
  DEFAULT_PAGES_PER_CLUSTER,
  MAX_PAGES_PER_CLUSTER,
} from "@/server/features/content-factory/rules/researchRules";

type ReadArgs = {
  projectId: string;
  clusterId: string;
  limit?: number;
};

export const readRankingPagesTool = {
  name: "read_ranking_pages",
  config: {
    title: "Read ranking-page bodies",
    description:
      "Open the pages that rank for a cluster and STORE their body text. Required before build_evidence_pack: SERP titles and snippets decide page type and platforms, but only the bodies tell you what competitors actually cover. Reads the top non-owned organic results after the deployment decision is approved, reuses bodies fetched in the last 14 days for free, and records pages it could not open so they become open questions instead of guesses. Consumes pageReads budget per page actually fetched.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGES_PER_CLUSTER)
        .optional()
        .describe(
          `How many pages to read. Default ${DEFAULT_PAGES_PER_CLUSTER}`,
        ),
    },
    outputSchema: z.looseObject({
      outcomes: z.array(looseObjectOutputSchema),
      openQuestions: z.array(z.string()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: ReadArgs, context) => {
    const { outcomes, openQuestions } = await ReadPagesService.readClusterPages(
      {
        projectId: args.projectId,
        clusterId: args.clusterId,
        limit: args.limit,
      },
    ).catch(rethrowAsAppError);
    const read = outcomes.filter((o) => o.status === "ok").length;
    const reused = outcomes.filter((o) => o.status === "reused").length;
    const blocked = outcomes.filter((o) => o.status === "blocked").length;
    const blockedNote = blocked
      ? ` ${blocked} could not be opened — they are recorded as open questions; do NOT infer what they say.`
      : "";
    return mcpResponse({
      text: `Read ${read} page(s), reused ${reused} recent one(s), ${blocked} unreadable.${blockedNote} Next: build_evidence_pack.`,
      structuredContent: { outcomes, openQuestions },
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      ),
    });
  }),
};
