import { OpportunityIntelError } from "../opportunityIntelErrors";
import {
  REPORT_PROMPT_VERSION,
  REPORT_SYSTEM,
  buildReportPrompt,
  dailyReportDataSchema,
  detailReportDataSchema,
  opportunityReportBlockSchema,
  reportMarkdownSchema,
  type DailyReportData,
  type OpportunityReportBlock,
} from "../prompts/report";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import type { OpportunityRow } from "../repositories/OpportunitiesRepository";
import { OpportunityCostEventsRepository } from "../repositories/OpportunityCostEventsRepository";
import { OpportunityDecisionLogRepository } from "../repositories/OpportunityDecisionLogRepository";
import { OpportunityKeywordsRepository } from "../repositories/OpportunityKeywordsRepository";
import { OpportunityReportsRepository } from "../repositories/OpportunityReportsRepository";
import { OpportunityScoresRepository } from "../repositories/OpportunityScoresRepository";
import { OpportunitySerpRepository } from "../repositories/OpportunitySerpRepository";
import { todayUtc } from "./costs";
import { runOpportunityLlm } from "./llm";

// Stage 8: the human interface. Blocks are assembled from stored rows (the
// scoring stage already produced positives/risks/next-action); the narrative
// LLM only turns the validated `data` JSON into markdown and may not add
// facts. A quiet day (nothing newly shortlisted) skips the LLM entirely.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRecord(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const num = (value: unknown, fallback = 0): number =>
  typeof value === "number" ? value : fallback;
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

async function buildBlock(
  opportunity: OpportunityRow,
): Promise<OpportunityReportBlock> {
  const [scoreRows, keywords] = await Promise.all([
    OpportunityScoresRepository.listByOpportunity(opportunity.id, 1),
    OpportunityKeywordsRepository.listByOpportunity(opportunity.id),
  ]);
  const breakdown = parseRecord(scoreRows[0]?.breakdown);
  const demand = isRecord(breakdown.demand) ? breakdown.demand : {};
  const analysis = isRecord(breakdown.analysis) ? breakdown.analysis : {};
  const perSnapshotGap = Array.isArray(breakdown.perSnapshotGap)
    ? breakdown.perSnapshotGap.filter(isRecord)
    : [];
  const countries: unknown = JSON.parse(opportunity.targetCountries);

  return opportunityReportBlockSchema.parse({
    opportunityId: opportunity.id,
    name: opportunity.name,
    type: opportunity.type,
    score: opportunity.latestScore,
    confidence: opportunity.latestConfidence,
    ipRisk: opportunity.ipRisk,
    targetCountries: strings(countries),
    keywordCount: new Set(keywords.map((row) => row.keyword)).size,
    demand: {
      commercialVolume: num(demand.commercialVolume),
      commercialIntentShare: num(demand.commercialIntentShare),
      laneApplied: demand.laneApplied === true,
    },
    supplyGap: {
      avgGapScore:
        typeof breakdown.serpSupplyGap === "number"
          ? breakdown.serpSupplyGap
          : null,
      perKeyword: perSnapshotGap.map((entry) => ({
        keyword: typeof entry.keyword === "string" ? entry.keyword : "?",
        gapScore: typeof entry.gapScore === "number" ? entry.gapScore : null,
      })),
    },
    positives: strings(analysis.positives),
    risks: strings(analysis.risks),
    nextAction:
      typeof analysis.recommendation === "string"
        ? analysis.recommendation
        : "Review the evidence and decide manually.",
  });
}

async function gateReasonFor(opportunityId: string): Promise<string> {
  const entries = await OpportunityDecisionLogRepository.listByOpportunity(
    opportunityId,
    10,
  );
  const gate = entries.find(
    (entry) => entry.decisionType === "gate_transition",
  );
  return gate?.reasonSummary ?? "";
}

function quietDayMarkdown(data: DailyReportData): string {
  const funnel = Object.entries(data.funnelCounts)
    .map(([status, count]) => `- ${status}: ${count}`)
    .join("\n");
  const spend = Object.entries(data.spendUsdByProvider)
    .map(([provider, usd]) => `- ${provider}: $${usd.toFixed(2)}`)
    .join("\n");
  return `# Opportunity report ${data.date}

No newly shortlisted opportunities today. ${data.watchlistedToday.length} watchlisted, ${data.rejectedToday.length} rejected.

## Funnel
${funnel || "- (empty)"}

## Spend today
${spend || "- $0.00"}
`;
}

async function generateRunReports(input: {
  organizationId: string;
  runId?: string | null;
}): Promise<{
  dailyReportId: string;
  detailReports: number;
}> {
  const date = todayUtc();
  const isToday = (row: OpportunityRow) =>
    row.statusChangedAt?.startsWith(date) ?? false;
  const [shortlisted, watchlisted, rejected, funnelCounts, spendUsdByProvider] =
    await Promise.all([
      OpportunitiesRepository.listByStatuses(input.organizationId, [
        "shortlisted",
      ]),
      OpportunitiesRepository.listByStatuses(input.organizationId, [
        "watchlist",
      ]),
      OpportunitiesRepository.listByStatuses(input.organizationId, [
        "rejected",
      ]),
      OpportunitiesRepository.countsByStatus(input.organizationId),
      OpportunityCostEventsRepository.spendByProviderForDate(
        input.organizationId,
        date,
      ),
    ]);
  const newly = shortlisted.filter(isToday);
  const watchlistedToday = watchlisted.filter(isToday).slice(0, 20);
  const rejectedToday = rejected.filter(isToday).slice(0, 20);

  const newlyShortlisted = [];
  for (const opportunity of newly) {
    newlyShortlisted.push(await buildBlock(opportunity));
  }
  const watchBlocks = [];
  for (const opportunity of watchlistedToday) {
    watchBlocks.push({
      opportunityId: opportunity.id,
      name: opportunity.name,
      score: opportunity.latestScore,
      reason: await gateReasonFor(opportunity.id),
    });
  }
  const rejectedBlocks = [];
  for (const opportunity of rejectedToday) {
    rejectedBlocks.push({
      name: opportunity.name,
      reason: await gateReasonFor(opportunity.id),
    });
  }

  const totalSpend = Object.values(spendUsdByProvider).reduce(
    (sum, usd) => sum + usd,
    0,
  );
  const data = dailyReportDataSchema.parse({
    date,
    funnelCounts,
    newlyShortlisted,
    watchlistedToday: watchBlocks,
    rejectedToday: rejectedBlocks,
    spendUsdByProvider,
    costPerShortlistedUsd:
      newly.length > 0
        ? Math.round((totalSpend / newly.length) * 100) / 100
        : null,
  });

  let markdown: string;
  if (newly.length === 0) {
    markdown = quietDayMarkdown(data);
  } else {
    const { object } = await runOpportunityLlm({
      organizationId: input.organizationId,
      endpoint: "llm_report",
      schema: reportMarkdownSchema,
      system: REPORT_SYSTEM,
      prompt: buildReportPrompt({
        kind: "daily",
        dataJson: JSON.stringify(data, null, 2),
      }),
      runId: input.runId,
    });
    markdown = object.markdown;
  }
  const dailyReportId = await OpportunityReportsRepository.insert({
    organizationId: input.organizationId,
    kind: "daily",
    reportDate: date,
    runId: input.runId ?? null,
    title: `Opportunity report ${date}`,
    content: markdown,
    data: JSON.stringify(data),
  });

  let detailReports = 0;
  for (const opportunity of newly) {
    const existing = await OpportunityReportsRepository.latestDetailFor(
      input.organizationId,
      opportunity.id,
    );
    if (existing && existing.createdAt >= (opportunity.statusChangedAt ?? "")) {
      continue;
    }
    await generateDetailReport({
      organizationId: input.organizationId,
      opportunityId: opportunity.id,
      runId: input.runId,
    });
    detailReports += 1;
  }
  return { dailyReportId, detailReports };
}

async function generateDetailReport(input: {
  organizationId: string;
  opportunityId: string;
  runId?: string | null;
}): Promise<{ reportId: string }> {
  const opportunity = await OpportunitiesRepository.getById(
    input.organizationId,
    input.opportunityId,
  );
  if (!opportunity) {
    throw new OpportunityIntelError(
      "OPPORTUNITY_NOT_FOUND",
      "Opportunity not found.",
    );
  }
  const block = await buildBlock(opportunity);
  const keywords = await OpportunityKeywordsRepository.listByOpportunity(
    input.opportunityId,
  );
  const keywordsByRole: Record<
    string,
    Array<{
      keyword: string;
      searchVolume: number | null;
      cpc: number | null;
      intent: string | null;
    }>
  > = {};
  const seenKeywords = new Set<string>();
  for (const row of keywords) {
    if (seenKeywords.has(row.keyword)) continue;
    seenKeywords.add(row.keyword);
    const bucket = (keywordsByRole[row.role] ??= []);
    if (bucket.length >= 15) continue;
    bucket.push({
      keyword: row.keyword,
      searchVolume: row.searchVolume,
      cpc: row.cpc,
      intent: row.intent,
    });
  }
  const latest = await OpportunitySerpRepository.getLatestWithResults(
    input.opportunityId,
  );
  const topResults = latest
    .flatMap((entry) =>
      entry.results
        .filter((result) => result.rank <= 10)
        .map((result) => ({
          keyword: entry.snapshot.keyword,
          rank: result.rank,
          domain: result.domain,
          pageClass: result.pageClass,
          title: result.title,
        })),
    )
    .slice(0, 30);

  const data = detailReportDataSchema.parse({
    ...block,
    description: opportunity.description,
    keywordsByRole,
    topResults,
  });
  const { object, model } = await runOpportunityLlm({
    organizationId: input.organizationId,
    endpoint: "llm_report",
    schema: reportMarkdownSchema,
    system: REPORT_SYSTEM,
    prompt: buildReportPrompt({
      kind: "detail",
      dataJson: JSON.stringify(data, null, 2),
    }),
    opportunityId: input.opportunityId,
    runId: input.runId,
  });
  const reportId = await OpportunityReportsRepository.insert({
    organizationId: input.organizationId,
    kind: "detail",
    reportDate: todayUtc(),
    opportunityId: input.opportunityId,
    runId: input.runId ?? null,
    title: `${opportunity.name} — opportunity detail`,
    content: object.markdown,
    data: JSON.stringify(data),
  });
  await OpportunityDecisionLogRepository.append({
    opportunityId: input.opportunityId,
    decisionType: "report",
    decision: JSON.stringify({ reportId }),
    reasonSummary: "Detail report generated.",
    model,
    promptVersion: REPORT_PROMPT_VERSION,
    createdBy: "system",
  });
  return { reportId };
}

export const ReportService = {
  generateRunReports,
  generateDetailReport,
};
