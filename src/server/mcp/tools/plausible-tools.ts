import { z } from "zod";
import { PlausibleService } from "@/server/features/plausible/services/PlausibleService";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { plausibleStatsInputSchema } from "@/types/schemas/plausible";

const outputSchema = z.looseObject({
  status: z.enum(["ok", "not_connected", "unsupported", "error"]),
  reason: z.string().optional(),
  message: z.string().optional(),
  plausibleSite: z.string().nullable().optional(),
  ...optionalMetaOutputSchema,
});

const annotations = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
} as const;

const NOT_CONNECTED_TEXT = {
  site_not_configured:
    "Plausible is not connected: this project has no plausible_site in the site registry (set it with upsert_site_registry).",
  api_key_missing:
    "Plausible is not connected: PLAUSIBLE_BASE_URL and PLAUSIBLE_API_KEY are not configured on this server.",
} as const;

type Outcome =
  | { status: "not_connected"; reason: keyof typeof NOT_CONNECTED_TEXT }
  | { status: "unsupported"; message: string }
  | { status: "error"; message: string };

function describeFailure(result: Outcome) {
  if (result.status === "not_connected") {
    return NOT_CONNECTED_TEXT[result.reason];
  }
  return result.message;
}

const fmt = (value: number | null) => (value === null ? "unknown" : value);

export const getPlausibleStatsTool = {
  name: "get_plausible_stats",
  config: {
    title: "Get Plausible stats",
    description:
      'Traffic summary for a project\'s Plausible site (the project\'s plausible_site in the site registry): visitors, visits, pageviews, bounce rate (percent), visit duration (seconds), for a preset window (default "30d") or an explicit startDate/endDate. Add dimension "page" or "source" for a top-pages or traffic-sources breakdown. Returns status "not_connected" (with a reason) when the server has no Plausible API key or the project has no plausible_site; that is a normal state, not a failure. Read-only; uses no credits.',
    inputSchema: {
      ...plausibleStatsInputSchema.shape,
      projectId: projectIdSchema,
    },
    outputSchema,
    annotations,
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<typeof plausibleStatsInputSchema>, context) => {
      const meta = buildProjectMeta(context, args.projectId);
      if (Boolean(args.startDate) !== Boolean(args.endDate)) {
        return mcpResponse({
          text: "Provide both startDate and endDate, or neither (use dateRange instead).",
          meta,
          structuredContent: {
            status: "error" as const,
            reason: "invalid_request",
          },
        });
      }
      const result = await PlausibleService.getStats(args);
      if (result.status !== "ok") {
        return mcpResponse({
          text: describeFailure(result),
          meta,
          structuredContent: result,
        });
      }
      const { totals } = result;
      const range = Array.isArray(result.dateRange)
        ? result.dateRange.join("→")
        : result.dateRange;
      const lines = [
        `${result.plausibleSite} · ${range}`,
        `visitors ${fmt(totals.visitors)} · visits ${fmt(totals.visits)} · pageviews ${fmt(totals.pageviews)} · bounce rate ${fmt(totals.bounceRate)}% · visit duration ${fmt(totals.visitDurationSeconds)}s`,
      ];
      if (result.rows) {
        lines.push(
          `Top ${result.dimension}s:`,
          ...result.rows.map(
            (row) =>
              `- ${row.key}  visitors ${fmt(row.visitors)}${row.pageviews === null ? "" : `  pageviews ${row.pageviews}`}${row.visits === null ? "" : `  visits ${row.visits}`}`,
          ),
        );
      }
      return mcpResponse({
        text: lines.join("\n"),
        meta,
        structuredContent: result,
      });
    },
  ),
};

export const listPlausibleSitesTool = {
  name: "list_plausible_sites",
  config: {
    title: "List Plausible sites",
    description:
      'Lists the sites the Plausible server knows, to check registry plausible_site values. Uses Plausible\'s optional Sites API: servers or API keys without access return status "unsupported" instead of an error. Returns status "not_connected" when no Plausible API key is configured. Read-only; uses no credits.',
    inputSchema: {} as Record<string, never>,
    outputSchema,
    annotations,
  },
  handler: async () => {
    const sites = await PlausibleService.listRemoteSites();
    if (sites.status !== "ok") {
      return mcpResponse({
        text: describeFailure(sites),
        structuredContent: sites,
      });
    }
    return mcpResponse({
      text: `Plausible sites (${sites.sites.length}): ${sites.sites.join(", ")}`,
      structuredContent: sites,
    });
  },
};

export const listPlausibleGoalsTool = {
  name: "list_plausible_goals",
  config: {
    title: "List Plausible goals",
    description:
      'Lists the goals configured on a project\'s Plausible site (its plausible_site in the site registry). Uses Plausible\'s optional Sites API: servers or API keys without access return status "unsupported" instead of an error. Returns status "not_connected" when no Plausible API key is configured or the project has no plausible_site. Read-only; uses no credits.',
    inputSchema: { projectId: projectIdSchema },
    outputSchema,
    annotations,
  },
  handler: withMcpProjectAuth(async (args: { projectId: string }, context) => {
    const meta = buildProjectMeta(context, args.projectId);
    const goals = await PlausibleService.listGoals(args.projectId);
    if (goals.status !== "ok") {
      return mcpResponse({
        text: describeFailure(goals),
        meta,
        structuredContent: goals,
      });
    }
    return mcpResponse({
      text: `Goals for ${goals.plausibleSite} (${goals.goals.length}): ${goals.goals.map((goal) => goal.displayName).join(", ") || "none"}`,
      meta,
      structuredContent: goals,
    });
  }),
};
