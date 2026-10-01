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
import { DraftService } from "@/server/features/content-factory/services/DraftService";

export const generateDraftTool = {
  name: "generate_draft",
  config: {
    title: "Write the page from its approved pack and brief",
    description:
      "Generate one asset's draft from exactly four inputs: the project rules, the approved knowledge, the approved evidence pack, and the brief. Requires the evidence pack to be APPROVED — the pack is what the draft's facts get checked against, so drafting before approval means checking against nothing. Structure follows the question rather than a template, open questions stay open, and structured data is only proposed when the page visibly contains that content. Uses 1 LLM budget unit.",
    inputSchema: {
      projectId: projectIdSchema,
      assetId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      draft: looseObjectOutputSchema,
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
      const result = await DraftService.generate(args).catch(rethrowAsAppError);
      return mcpResponse({
        text:
          `Drafted "${result.draft.title}" (/${result.draft.slug}).\n` +
          `Adds: ${result.draft.addedValue}\n` +
          `${result.draft.claimsUsed.length} evidence item(s) cited, ${result.draft.internalLinkTargets.length} internal link(s), ${result.draft.imageBriefs.length} image brief(s).\n` +
          `Next: run_qa — the model that wrote this is the worst judge of whether its facts are grounded.`,
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

export const runQaTool = {
  name: "run_qa",
  config: {
    title: "Review a draft against its evidence",
    description:
      "Independent QA over six dimensions: factual grounding, whether it answers the query, project boundary, duplication with our own pages, expression quality, and technical requirements. Fixable problems are rewritten automatically at most twice; grounding, boundary and duplication findings go straight to a human, because asking a model to fix an unsourced claim asks it to invent a source. A passing draft moves to ready_to_publish, anything else waits in qa_review. Uses 1-3 LLM budget units depending on rewrites.",
    inputSchema: {
      projectId: projectIdSchema,
      assetId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      verdict: z.string(),
      explanation: z.string(),
      findings: z.array(looseObjectOutputSchema),
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
      const result = await DraftService.runQa(args).catch(rethrowAsAppError);
      const findings = result.findings.length
        ? `\n${result.findings.map((f) => `- [${f.severity}/${f.dimension}] ${f.detail}`).join("\n")}`
        : "";
      return mcpResponse({
        text: `${result.verdict.toUpperCase()} — ${result.explanation}${findings}`,
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
