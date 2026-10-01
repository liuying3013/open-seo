import { z } from "zod";
import { CandidateKeywordsService } from "@/server/features/keywords/services/CandidateKeywordsService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";

const inputSchema = {
  projectId: projectIdSchema,
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Optional keyword text filter."),
} as const;

export const listCandidateKeywordsTool = {
  name: "list_candidate_keywords",
  config: {
    title: "List candidate keywords",
    description:
      "Lists the project's Candidate Keywords shortlist (Content Ops input). Uses no credits — reads from OpenSEO's database. Saved Keywords is a separate opportunity/research dump; use list_saved_keywords for that.",
    inputSchema,
    outputSchema: z.looseObject({
      rows: z.array(looseObjectOutputSchema),
      totalCount: z.number(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof inputSchema>>, context) => {
      const { rows } = await CandidateKeywordsService.list({
        projectId: args.projectId,
      });
      const needle = args.search?.trim().toLocaleLowerCase();
      const filtered = needle
        ? rows.filter((row) => row.keyword.toLocaleLowerCase().includes(needle))
        : rows;
      const text =
        filtered.length === 0
          ? "No candidate keywords yet."
          : `Candidate keywords (${filtered.length} of ${rows.length}):\n` +
            filtered
              .map(
                (row) =>
                  `- ${row.keyword}${row.source ? `  source:${row.source}` : ""}`,
              )
              .join("\n");
      return mcpResponse({
        text,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/candidate-keywords`,
        ),
        structuredContent: { rows: filtered, totalCount: rows.length },
      });
    },
  ),
};
