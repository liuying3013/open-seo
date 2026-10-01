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
import { ContextPackService } from "@/server/features/content-factory/services/ContextPackService";

export const getContextPackTool = {
  name: "get_context_pack",
  config: {
    title: "Get the pre-writing context pack",
    description:
      "What this project already knows about a cluster, assembled BEFORE spending on research. Three layers: the project rules that always apply (product boundary, positioning, taxonomy, competitors), the accumulated knowledge relevant to this topic, and what we have already published on it. The output separates settled knowledge from possibly-stale knowledge from open questions — treat those three differently, and never present a stale or open item as established fact. Free: reads stored data only.",
    inputSchema: {
      projectId: projectIdSchema,
      clusterId: z.string().min(1),
    },
    outputSchema: z.looseObject({
      cluster: looseObjectOutputSchema,
      known: z.array(looseObjectOutputSchema),
      possiblyStale: z.array(looseObjectOutputSchema),
      openQuestions: z.array(z.string()),
      coveringPages: z.array(looseObjectOutputSchema),
      rules: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: { projectId: string; clusterId: string }, context) => {
      const pack =
        await ContextPackService.buildForCluster(args).catch(rethrowAsAppError);
      const lines = [
        `Cluster: ${pack.cluster.name} [${pack.cluster.entity ?? "no entity"} / ${pack.cluster.userJob ?? "no job"}]`,
        "",
        `KNOWN AND USABLE (${pack.known.length}):`,
        ...pack.known
          .slice(0, 15)
          .map((k) => `  - [${k.claimType}] ${k.statement}`),
        "",
        `POSSIBLY STALE — recheck before citing (${pack.possiblyStale.length}):`,
        ...pack.possiblyStale
          .slice(0, 10)
          .map(
            (k) =>
              `  - [${k.claimType}] ${k.statement} (due ${k.recheckAfter})`,
          ),
        "",
        `OPEN QUESTIONS — not known, do not infer (${pack.openQuestions.length}):`,
        ...pack.openQuestions.slice(0, 10).map((q) => `  - ${q}`),
        "",
        pack.coveringPages.length
          ? `We already have ${pack.coveringPages.length} page(s) on this topic: ${pack.coveringPages.map((p) => p.url).join(", ")}`
          : "No existing page of ours covers this topic.",
        pack.rules.entityTaxonomy
          ? ""
          : "No entity-taxonomy section is configured for this project.",
      ].filter((line) => line !== null);
      return mcpResponse({
        text: lines.join("\n"),
        structuredContent: pack,
        meta: buildProjectMeta(
          context,
          args.projectId,
          `/p/${args.projectId}/content-ops`,
        ),
      });
    },
  ),
};
