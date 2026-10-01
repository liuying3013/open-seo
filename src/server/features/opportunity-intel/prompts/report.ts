import { z } from "zod";

export const REPORT_PROMPT_VERSION = "opp-report-v1";

// The report's `data` JSON is the trust boundary: the narrative LLM receives
// ONLY this validated evidence and may not introduce facts beyond it. The
// JSON is stored beside the markdown so every claim stays auditable.

export const opportunityReportBlockSchema = z.object({
  opportunityId: z.string(),
  name: z.string(),
  type: z.string(),
  score: z.number().nullable(),
  confidence: z.number().nullable(),
  ipRisk: z.string(),
  targetCountries: z.array(z.string()),
  keywordCount: z.number(),
  demand: z.object({
    commercialVolume: z.number(),
    commercialIntentShare: z.number(),
    laneApplied: z.boolean(),
  }),
  supplyGap: z.object({
    avgGapScore: z.number().nullable(),
    perKeyword: z.array(
      z.object({ keyword: z.string(), gapScore: z.number().nullable() }),
    ),
  }),
  positives: z.array(z.string()),
  risks: z.array(z.string()),
  nextAction: z.string(),
});
export type OpportunityReportBlock = z.infer<
  typeof opportunityReportBlockSchema
>;

export const dailyReportDataSchema = z.object({
  date: z.string(),
  funnelCounts: z.record(z.string(), z.number()),
  newlyShortlisted: z.array(opportunityReportBlockSchema),
  watchlistedToday: z.array(
    z.object({
      opportunityId: z.string(),
      name: z.string(),
      score: z.number().nullable(),
      reason: z.string(),
    }),
  ),
  rejectedToday: z.array(z.object({ name: z.string(), reason: z.string() })),
  spendUsdByProvider: z.record(z.string(), z.number()),
  /** PRD §29's operating metric; null when nothing was shortlisted today. */
  costPerShortlistedUsd: z.number().nullable(),
});
export type DailyReportData = z.infer<typeof dailyReportDataSchema>;

export const detailReportDataSchema = opportunityReportBlockSchema.extend({
  description: z.string().nullable(),
  keywordsByRole: z.record(
    z.string(),
    z.array(
      z.object({
        keyword: z.string(),
        searchVolume: z.number().nullable(),
        cpc: z.number().nullable(),
        intent: z.string().nullable(),
      }),
    ),
  ),
  topResults: z.array(
    z.object({
      keyword: z.string(),
      rank: z.number(),
      domain: z.string(),
      pageClass: z.string().nullable(),
      title: z.string().nullable(),
    }),
  ),
});

export const reportMarkdownSchema = z.object({
  markdown: z
    .string()
    .describe("The complete report, GitHub-flavored markdown"),
});

export const REPORT_SYSTEM = `You write the human-facing report of a cross-border opportunity discovery funnel, in clean GitHub-flavored markdown.

HARD RULE: every factual claim must come from the evidence JSON you are given. Never invent market sizes, prices, suppliers, or trends that are not in it. If evidence is thin, say so — the confidence number exists for that reason.

Structure each opportunity block as: header with score + confidence + type + target countries; Demand; Supply gap; Why (positives); Risks; Next action. Keep the writing tight and operator-oriented — this is a working document, not marketing.`;

export function buildReportPrompt(input: {
  kind: "daily" | "detail";
  dataJson: string;
}): string {
  return `Write the ${input.kind} report from this evidence JSON (your ONLY source of facts):

${input.dataJson}`;
}
