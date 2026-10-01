import type { BillingCustomerContext } from "@/server/billing/subscription";
import { createDataforseoClient } from "@/server/lib/dataforseo/client";
import { fetchKeywordMetricsForList } from "@/server/lib/dataforseo/keyword-metrics";
import { RUN_CAPS } from "../rules/scoringRules";
import {
  OpportunityKeywordsRepository,
  type OpportunityKeywordRow,
} from "../repositories/OpportunityKeywordsRepository";
import { checkDailyBudget, recordCostEvent } from "./costs";
import { syncFetchedKeywordsToProject, toSyncKeywordRow } from "./keywordSync";

// Stage 3: hydrate an opportunity's keywords with DataForSEO metrics, one
// batched request set per (location, language) market. Idempotent by
// construction: rows are selected by missing/stale metricsFetchedAt and
// keywords the provider returns nothing for are stamped anyway (null metrics
// = "fetched, no data" — PRD §11 keeps them alive).

const METRICS_BATCH_SIZE = 700;

async function fetchOpportunityMetrics(input: {
  opportunityId: string;
  customer: BillingCustomerContext;
  runId?: string | null;
}): Promise<{ updated: number }> {
  const staleBefore = new Date(
    Date.now() - RUN_CAPS.metricsRefetchDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const pending = await OpportunityKeywordsRepository.listNeedingMetrics(
    input.opportunityId,
    staleBefore,
  );
  if (pending.length === 0) return { updated: 0 };

  const markets = new Map<string, OpportunityKeywordRow[]>();
  for (const row of pending) {
    const key = `${row.locationCode}|${row.languageCode}`;
    const bucket = markets.get(key);
    if (bucket) bucket.push(row);
    else markets.set(key, [row]);
  }

  const client = createDataforseoClient(input.customer);
  const now = new Date().toISOString();
  let updated = 0;

  for (const rows of markets.values()) {
    const { locationCode, languageCode } = rows[0];
    const keywords = [...new Set(rows.map((row) => row.keyword))];
    const batches = Math.ceil(keywords.length / METRICS_BATCH_SIZE);
    await checkDailyBudget(
      input.customer.organizationId,
      "labs_keyword_metrics",
      batches,
    );
    const metricRows = await fetchKeywordMetricsForList(client, {
      keywords,
      locationCode,
      languageCode,
      creditFeature: "keyword_research",
    });
    await recordCostEvent({
      organizationId: input.customer.organizationId,
      provider: "dataforseo",
      endpoint: "labs_keyword_metrics",
      requestCount: batches,
      opportunityId: input.opportunityId,
      runId: input.runId,
    });

    const byKeyword = new Map(
      metricRows.map((row) => [row.keyword.toLowerCase(), row]),
    );
    const fetched: OpportunityKeywordRow[] = [];
    for (const row of rows) {
      const metrics = byKeyword.get(row.keyword);
      const next = {
        searchVolume: metrics?.searchVolume ?? null,
        cpc: metrics?.cpc ?? null,
        competition: metrics?.competition ?? null,
        keywordDifficulty: metrics?.keywordDifficulty ?? null,
        trend: metrics?.monthlySearches.length
          ? JSON.stringify(metrics.monthlySearches)
          : null,
        metricsFetchedAt: now,
      };
      await OpportunityKeywordsRepository.updateMetricsById(row.id, next);
      fetched.push({ ...row, ...next });
      updated += 1;
    }
    try {
      await syncFetchedKeywordsToProject({
        organizationId: input.customer.organizationId,
        opportunityId: input.opportunityId,
        rows: fetched.map(toSyncKeywordRow),
      });
    } catch (error) {
      console.error(
        "[opportunity-intel] fetch-time saved-keyword sync failed after metrics",
        error,
      );
    }
  }

  return { updated };
}

export const MetricsService = {
  fetchOpportunityMetrics,
};
