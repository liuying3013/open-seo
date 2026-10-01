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
import { PageCoverageService } from "@/server/features/content-factory/services/PageCoverageService";

export const compareExistingPagesTool = {
  name: "compare_existing_pages",
  config: {
    title: "Compare a cluster against pages we already have",
    description:
      "Decide whether a cluster needs a NEW page, an UPDATE to one we have, an OPTIMIZE pass, a MERGE proposal, or a SKIP. Compared against the site audit's crawl of our own domain, so it reflects what is actually published rather than what we remember publishing. MERGE is a proposal only — consolidating, deleting or moving a URL needs your explicit confirmation and this tool never performs it. Free: reads stored crawl data. Omit clusterId to classify every cluster in the project.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1).optional(),
    },
    outputSchema: z.looseObject({
      verdict: z.string().optional(),
      reason: z.string().optional(),
      pages: z.array(looseObjectOutputSchema).optional(),
      results: z.array(looseObjectOutputSchema).optional(),
      counts: z.record(z.string(), z.number()).optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; clusterId?: string }, context) => {
      const meta = buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/content-ops`,
      );
      if (args.clusterId) {
        const result = await PageCoverageService.classifyCluster({
          projectId: args.projectId,
          clusterId: args.clusterId,
        }).catch(rethrowAsAppError);
        const pages = result.pages.length
          ? `\nOur pages involved:\n${result.pages.map((p) => `- ${p.url} (${p.wordCount ?? "?"} words, ${p.internalLinkCount ?? "?"} internal links)`).join("\n")}`
          : "";
        return mcpResponse({
          text:
            `${result.verdict.toUpperCase()}: ${result.reason}${pages}` +
            (result.requiresHumanConfirmation
              ? "\n\nThis needs your explicit confirmation before anything is changed."
              : ""),
          structuredContent: result,
          meta,
        });
      }
      const results = await PageCoverageService.classifyProject({
        projectId: args.projectId,
      }).catch(rethrowAsAppError);
      const counts = results.reduce<Record<string, number>>((acc, row) => {
        acc[row.verdict] = (acc[row.verdict] ?? 0) + 1;
        return acc;
      }, {});
      return mcpResponse({
        text:
          `${results.length} cluster(s): ` +
          Object.entries(counts)
            .map(([verdict, n]) => `${verdict} ${n}`)
            .join(", ") +
          "\n" +
          results
            .map((r) => `- [${r.verdict}] ${r.clusterName} — ${r.reason}`)
            .join("\n"),
        structuredContent: { results, counts },
        meta,
      });
    },
  ),
};
