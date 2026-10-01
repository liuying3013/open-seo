import { z } from "zod";
import { looseObjectOutputSchema } from "@/server/mcp/output-schemas";
import { mcpResponse } from "@/server/mcp/formatters";
import type { ToolContext } from "@/server/mcp/context";
import { TaskPoolService } from "@/server/features/content-factory/services/TaskPoolService";

export const getTaskPoolTool = {
  name: "get_task_pool",
  config: {
    title: "Get the cross-project task pool",
    description:
      "Today's content tasks across every project, ranked by value and annotated with why. Ranking is global — a strong task in one project outranks a weak one in another — while spending is gated per project: a task whose project has exhausted its daily budget is marked not-runnable and the walk continues, so one project running dry never stalls the others. Every entry carries a sentence explaining its position, not just a score. Free: reads stored data.",
    inputSchema: {
      projectIds: z
        .array(z.string())
        .optional()
        .describe("Restrict to these projects; default is all of them"),
      limit: z.number().int().min(1).max(50).optional(),
    },
    outputSchema: z.looseObject({
      ruleVersion: z.string(),
      tasks: z.array(looseObjectOutputSchema),
      runnable: z.number(),
      skippedForBudget: z.array(looseObjectOutputSchema),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  // Organization-scoped rather than project-scoped: the whole point is to
  // compare across projects, so there is no single project to authorize
  // against. Same shape as the opportunity-intel tools.
  handler: async (
    args: { projectIds?: string[]; limit?: number },
    context: ToolContext,
  ) => {
    const pool = await TaskPoolService.build({
      organizationId: context.auth.organizationId,
      projectIds: args.projectIds,
      limit: args.limit,
    });
    const skipped = pool.skippedForBudget.length
      ? `\n\nSkipped for budget: ${pool.skippedForBudget
          .map((s) => `${s.projectName} (${s.count})`)
          .join(", ")} — raise that project's daily limit if this is wrong.`
      : "";
    return mcpResponse({
      text:
        `${pool.tasks.length} task(s), ${pool.runnable} runnable today.\n` +
        pool.tasks
          .map(
            (t) =>
              `${t.runnable ? " " : "x"} ${t.score.toFixed(1)} [${t.coverageVerdict}] ${t.reason}` +
              (t.blockedBy ? ` BLOCKED: ${t.blockedBy}` : ""),
          )
          .join("\n") +
        skipped,
      structuredContent: pool,
    });
  },
};
