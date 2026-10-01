import { z } from "zod";
import { CandidateKeywordsService } from "@/server/features/keywords/services/CandidateKeywordsService";
import { mcpResponse } from "@/server/mcp/formatters";
import { buildProjectMeta } from "@/server/mcp/context";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { resolveMarket } from "@/shared/keyword-locations";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";
import { keywordSourceSchema } from "@/types/schemas/keywords";

const inputSchema = {
  projectId: projectIdSchema,
  keywords: z
    .array(z.string().min(1))
    .min(1)
    .max(500)
    .describe("Candidate keywords to save (1-500)."),
  locationCode: locationCodeSchema.optional(),
  languageCode: languageCodeSchema.optional(),
  source: keywordSourceSchema
    .optional()
    .describe(
      "Where these keywords came from (content-ops provenance), e.g. competitor, gsc, whatsapp, manual.",
    ),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const saveCandidateKeywordsTool = {
  name: "save_candidate_keywords",
  config: {
    title: "Save candidate keywords",
    description:
      "Save keywords to a project's Candidate Keywords shortlist (the Content Ops input). Does not write to Saved Keywords, which is the opportunity/research dump. Uses no credits — does not call DataForSEO. Idempotent: re-saving an existing keyword is a no-op.",
    inputSchema,
    outputSchema: z.looseObject({
      projectId: z.string(),
      savedCount: z.number(),
      keywords: z.array(z.string()),
      locationCode: z.number(),
      languageCode: z.string(),
      source: z.string().nullable(),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: Args, context) => {
    const { locationCode, languageCode } = resolveMarket(args, context.project);
    const result = await CandidateKeywordsService.save({
      projectId: args.projectId,
      keywords: args.keywords,
      locationCode,
      languageCode,
      source: args.source,
    });

    return mcpResponse({
      text: `Saved ${result.savedCount} candidate keyword(s) to project ${args.projectId}.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/candidate-keywords`,
      ),
      structuredContent: {
        projectId: args.projectId,
        savedCount: result.savedCount,
        keywords: result.rows.map((row) => row.keyword),
        locationCode,
        languageCode,
        source: args.source ?? null,
      },
    });
  }),
};
