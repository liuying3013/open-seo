import { z } from "zod";
import type { BillingCustomerContext } from "@/server/billing/subscription";
import { AppError } from "@/server/lib/errors";
import { mcpResponse } from "@/server/mcp/formatters";
import {
  looseObjectOutputSchema,
  optionalMetaOutputSchema,
} from "@/server/mcp/output-schemas";
import type { ToolContext } from "@/server/mcp/context";
import { OpportunitiesRepository } from "@/server/features/opportunity-intel/repositories/OpportunitiesRepository";
import { OpportunityCostEventsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityCostEventsRepository";
import { OpportunityDecisionLogRepository } from "@/server/features/opportunity-intel/repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityKeywordsRepository";
import { OpportunityReportsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityReportsRepository";
import { OpportunityRunsRepository } from "@/server/features/opportunity-intel/repositories/OpportunityRunsRepository";
import { OpportunityScoresRepository } from "@/server/features/opportunity-intel/repositories/OpportunityScoresRepository";
import { OpportunitySerpRepository } from "@/server/features/opportunity-intel/repositories/OpportunitySerpRepository";
import {
  OPPORTUNITY_TYPES,
  RUN_CAPS,
} from "@/server/features/opportunity-intel/rules/scoringRules";
import { rethrowAsAppError } from "@/server/features/opportunity-intel/opportunityIntelErrors";
import { OPPORTUNITY_STATUSES } from "@/server/features/opportunity-intel/stateMachine";
import { IntakeService } from "@/server/features/opportunity-intel/services/IntakeService";
import { OpportunityReviewService } from "@/server/features/opportunity-intel/services/ReviewService";
import { ScanRunner } from "@/server/features/opportunity-intel/services/ScanRunner";
import { todayUtc } from "@/server/features/opportunity-intel/services/costs";

// Opportunity-intel tools are ACCOUNT-level (the discovery funnel has no
// project until graduation): auth is the transport's verified identity, and
// billing attribution carries no projectId.

function customerFrom(context: ToolContext): BillingCustomerContext {
  return {
    userId: context.auth.userId,
    userEmail: context.auth.userEmail,
    organizationId: context.auth.organizationId,
  };
}

const readOnly = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
};

const seedSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  targetCountries: z
    .array(z.string().min(2).max(3))
    .max(5)
    .optional()
    .describe("ISO short country codes, default ['US']"),
  languageCode: z.string().min(2).max(8).optional(),
  notes: z.string().max(2000).optional(),
});

export const addOpportunitiesTool = {
  name: "add_opportunities",
  config: {
    title: "Add opportunity seeds",
    description:
      "Register candidate opportunities in the discovery funnel. Each new seed runs one LLM intake pass (definition, type check, IP-risk grade); names that already exist return the existing opportunity instead of duplicating. Charged: 1 LLM call per new seed.",
    inputSchema: { seeds: z.array(seedSchema).min(1).max(20) },
    outputSchema: z.looseObject({
      created: z.array(looseObjectOutputSchema),
      duplicates: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  handler: async (
    args: { seeds: z.infer<typeof seedSchema>[] },
    context: ToolContext,
  ) => {
    const result = await IntakeService.addOpportunities({
      organizationId: context.auth.organizationId,
      seeds: args.seeds,
      createdBy: "agent",
    }).catch(rethrowAsAppError);
    const createdLines = result.created.map(
      (item) => `- ${item.name} [${item.id}] (${item.type}, IP ${item.ipRisk})`,
    );
    const dupLines = result.duplicates.map(
      (item) => `- ${item.name} = existing ${item.existingId} (${item.status})`,
    );
    return mcpResponse({
      text: [
        createdLines.length > 0
          ? `Registered ${createdLines.length}:\n${createdLines.join("\n")}`
          : "Nothing new registered.",
        dupLines.length > 0 ? `Already known:\n${dupLines.join("\n")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      structuredContent: result,
    });
  },
};

export const runOpportunityScanTool = {
  name: "run_opportunity_scan",
  config: {
    title: "Run an opportunity scan",
    description:
      "Run the staged discovery batch: expand keywords, fetch metrics, classify intents, gate on demand, fetch SERPs, analyze the supply gap, score + gate, and write the report. Deterministic gates decide everything; budget exhaustion pauses the run (rerun to resume). Charged: DataForSEO + LLM within daily caps.",
    inputSchema: {
      maxOpportunities: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe(`Per-stage cap, default ${RUN_CAPS.opportunitiesPerScan}`),
    },
    outputSchema: z.looseObject({
      runId: z.string(),
      status: z.string(),
      stats: looseObjectOutputSchema,
      ...optionalMetaOutputSchema,
    }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  handler: async (
    args: { maxOpportunities?: number },
    context: ToolContext,
  ) => {
    const result = await ScanRunner.runOpportunityScan({
      customer: customerFrom(context),
      maxOpportunities: args.maxOpportunities,
    }).catch(rethrowAsAppError);
    const spend = Object.entries(result.stats.spendUsdByProvider)
      .map(([provider, usd]) => `${provider} $${usd.toFixed(2)}`)
      .join(", ");
    return mcpResponse({
      text:
        `Scan ${result.status} (run ${result.runId}).\n` +
        `Keyword stage: ${JSON.stringify(result.stats.keywordStage)}\n` +
        `SERP stage: ${JSON.stringify(result.stats.serpStage)}\n` +
        `Errors: ${result.stats.errors.length}. Spend today: ${spend || "$0"}.` +
        (result.status === "paused"
          ? "\nA daily budget cap paused the run; rerun tomorrow (or raise caps) to resume."
          : ""),
      structuredContent: result,
    });
  },
};

export const getOpportunityPipelineStatusTool = {
  name: "get_opportunity_pipeline_status",
  config: {
    title: "Opportunity pipeline status",
    description:
      "Funnel counts by status, today's spend by provider, and recent runs. Free.",
    inputSchema: {},
    outputSchema: z.looseObject({
      counts: looseObjectOutputSchema,
      spendUsdByProvider: looseObjectOutputSchema,
      runs: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: async (_args: Record<never, never>, context: ToolContext) => {
    const organizationId = context.auth.organizationId;
    const [counts, spend, runs] = await Promise.all([
      OpportunitiesRepository.countsByStatus(organizationId),
      OpportunityCostEventsRepository.spendByProviderForDate(
        organizationId,
        todayUtc(),
      ),
      OpportunityRunsRepository.listRecent(organizationId, 5),
    ]);
    const countText =
      Object.entries(counts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(", ") || "no opportunities yet";
    const spendText =
      Object.entries(spend)
        .map(([provider, usd]) => `${provider} $${usd.toFixed(2)}`)
        .join(", ") || "$0";
    return mcpResponse({
      text: `Funnel — ${countText}.\nSpend today — ${spendText}.\nRecent runs: ${runs
        .map((run) => `${run.kind}/${run.status} @ ${run.startedAt}`)
        .join("; ")}`,
      structuredContent: { counts, spendUsdByProvider: spend, runs },
    });
  },
};

export const listOpportunitiesTool = {
  name: "list_opportunities",
  config: {
    title: "List opportunities",
    description:
      "List opportunities with optional status/type/score filters, newest stage-change first. Free.",
    inputSchema: {
      status: z.enum(OPPORTUNITY_STATUSES).optional(),
      type: z.enum(OPPORTUNITY_TYPES).optional(),
      minScore: z.number().min(0).max(100).optional(),
      limit: z.number().int().min(1).max(100).default(25).optional(),
    },
    outputSchema: z.looseObject({
      opportunities: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: async (
    args: {
      status?: (typeof OPPORTUNITY_STATUSES)[number];
      type?: (typeof OPPORTUNITY_TYPES)[number];
      minScore?: number;
      limit?: number;
    },
    context: ToolContext,
  ) => {
    const rows = await OpportunitiesRepository.listByStatuses(
      context.auth.organizationId,
      args.status ? [args.status] : [...OPPORTUNITY_STATUSES],
      200,
    );
    const filtered = rows
      .filter((row) => !args.type || row.type === args.type)
      .filter(
        (row) =>
          args.minScore === undefined ||
          (row.latestScore ?? -1) >= args.minScore,
      )
      .slice(0, args.limit ?? 25);
    return mcpResponse({
      text:
        filtered
          .map(
            (row) =>
              `- ${row.name} [${row.id}] ${row.status} (${row.type}, score ${row.latestScore ?? "?"}, confidence ${row.latestConfidence ?? "?"}, IP ${row.ipRisk})`,
          )
          .join("\n") || "No opportunities match.",
      structuredContent: {
        opportunities: filtered.map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          status: row.status,
          score: row.latestScore,
          confidence: row.latestConfidence,
          ipRisk: row.ipRisk,
          statusChangedAt: row.statusChangedAt,
        })),
      },
    });
  },
};

export const getOpportunityTool = {
  name: "get_opportunity",
  config: {
    title: "Get opportunity detail",
    description:
      "Full evidence for one opportunity: keywords (by role), SERP snapshots with gap scores, score history, decision log, reports. Free.",
    inputSchema: { opportunityId: z.string().min(1) },
    outputSchema: z.looseObject({
      opportunity: looseObjectOutputSchema,
      keywords: z.array(looseObjectOutputSchema),
      snapshots: z.array(looseObjectOutputSchema),
      scores: z.array(looseObjectOutputSchema),
      decisionLog: z.array(looseObjectOutputSchema),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: async (args: { opportunityId: string }, context: ToolContext) => {
    const opportunity = await OpportunitiesRepository.getById(
      context.auth.organizationId,
      args.opportunityId,
    );
    if (!opportunity) {
      throw new AppError(
        "NOT_FOUND",
        `Opportunity ${args.opportunityId} not found.`,
      );
    }
    const [keywords, latest, scores, log] = await Promise.all([
      OpportunityKeywordsRepository.listByOpportunity(args.opportunityId),
      OpportunitySerpRepository.getLatestWithResults(args.opportunityId),
      OpportunityScoresRepository.listByOpportunity(args.opportunityId, 5),
      OpportunityDecisionLogRepository.listByOpportunity(
        args.opportunityId,
        30,
      ),
    ]);
    return mcpResponse({
      text:
        `${opportunity.name} — ${opportunity.status} (${opportunity.type}, score ${opportunity.latestScore ?? "?"} / confidence ${opportunity.latestConfidence ?? "?"}, IP ${opportunity.ipRisk}).\n` +
        `${new Set(keywords.map((row) => row.keyword)).size} keywords, ${latest.length} SERP snapshots (gap: ${latest
          .map(
            (entry) =>
              `${entry.snapshot.keyword}=${entry.snapshot.gapScore ?? "?"}`,
          )
          .join(", ")}).`,
      structuredContent: {
        opportunity,
        keywords: keywords.slice(0, 300),
        snapshots: latest.map((entry) => ({
          ...entry.snapshot,
          results: entry.results.slice(0, 20),
        })),
        scores,
        decisionLog: log,
      },
    });
  },
};

export const getOpportunityReportTool = {
  name: "get_opportunity_report",
  config: {
    title: "Get opportunity report",
    description:
      "Fetch the latest daily report (default) or an opportunity's detail report as markdown. Free.",
    inputSchema: { opportunityId: z.string().min(1).optional() },
    outputSchema: z.looseObject({
      id: z.string(),
      kind: z.string(),
      reportDate: z.string(),
      data: z.unknown(),
      ...optionalMetaOutputSchema,
    }),
    annotations: readOnly,
  },
  handler: async (args: { opportunityId?: string }, context: ToolContext) => {
    const organizationId = context.auth.organizationId;
    const report = args.opportunityId
      ? await OpportunityReportsRepository.latestDetailFor(
          organizationId,
          args.opportunityId,
        )
      : await OpportunityReportsRepository.latestDaily(organizationId);
    if (!report) {
      throw new AppError(
        "NOT_FOUND",
        "No report yet — run run_opportunity_scan first.",
      );
    }
    return mcpResponse({
      text: report.content,
      structuredContent: {
        id: report.id,
        kind: report.kind,
        reportDate: report.reportDate,
        data: report.data,
      },
    });
  },
};

export const reviewOpportunityTool = {
  name: "review_opportunity",
  config: {
    title: "Review an opportunity",
    description:
      "Human review actions on the funnel: graduate (requires an EXISTING projectId — upserts fetched keywords into saved_keywords with source='opportunity' and seeds project memory), sync_keywords (same keyword write into a project WITHOUT graduating). Metrics and SERP fetches already write those keywords into the org's project as soon as DataForSEO returns; these actions backfill. Confirm with the user before graduating or rejecting.",
    inputSchema: {
      opportunityId: z.string().min(1),
      action: z.enum([
        "graduate",
        "reject",
        "watchlist",
        "resume",
        "sync_keywords",
      ]),
      projectId: z.string().min(1).optional(),
      notes: z.string().max(2000).optional(),
    },
    outputSchema: z.looseObject({
      status: z.string(),
      promotedKeywords: z.number().optional(),
      ...optionalMetaOutputSchema,
    }),
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  handler: async (
    args: {
      opportunityId: string;
      action: "graduate" | "reject" | "watchlist" | "resume" | "sync_keywords";
      projectId?: string;
      notes?: string;
    },
    context: ToolContext,
  ) => {
    const result = await OpportunityReviewService.review({
      opportunityId: args.opportunityId,
      action: args.action,
      organizationId: context.auth.organizationId,
      projectId: args.projectId ?? null,
      notes: args.notes ?? null,
    }).catch(rethrowAsAppError);
    return mcpResponse({
      text:
        args.action === "graduate"
          ? `Graduated onto project ${args.projectId}: ${result.promotedKeywords} keywords promoted (source='opportunity'), project memory seeded.`
          : args.action === "sync_keywords"
            ? `Synced ${result.promotedKeywords} keywords (with metrics) into project ${args.projectId}; opportunity status unchanged (${result.status}).`
            : `Opportunity is now ${result.status}.`,
      structuredContent: result,
    });
  },
};
