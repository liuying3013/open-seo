import type { BillingCustomerContext } from "@/server/billing/subscription";
import { mapWithConcurrency } from "@/server/lib/concurrency";
import { OpportunityIntelError } from "../opportunityIntelErrors";
import { CONCURRENCY, RUN_CAPS } from "../rules/scoringRules";
import { OpportunitiesRepository } from "../repositories/OpportunitiesRepository";
import { OpportunityCostEventsRepository } from "../repositories/OpportunityCostEventsRepository";
import { OpportunityRunsRepository } from "../repositories/OpportunityRunsRepository";
import { todayUtc } from "./costs";
import { ReportService } from "./ReportService";
import { ExpansionService } from "./ExpansionService";
import { GapService } from "./GapService";
import { IntentService } from "./IntentService";
import { MetricsService } from "./MetricsService";
import { OpportunitySerpService } from "./SerpService";
import { ScoringService } from "./ScoringService";

// The batch orchestrator. Deterministic and dumb on purpose: stages select
// work by opportunity status, every opportunity gets per-item error isolation,
// and a budget exhaustion pauses the whole run (the next run resumes exactly
// the remainder because nothing but statuses drive selection). The LLM never
// decides what runs next.

type StageCounters = {
  processed: number;
  advanced: number;
  watchlisted: number;
  rejected: number;
  errors: number;
};

type ScanStats = {
  keywordStage: StageCounters;
  serpStage: StageCounters;
  errors: Array<{ opportunityId: string; stage: string; message: string }>;
  spendUsdByProvider: Record<string, number>;
};

const newCounters = (): StageCounters => ({
  processed: 0,
  advanced: 0,
  watchlisted: 0,
  rejected: 0,
  errors: 0,
});

function bump(counters: StageCounters, outcome: string): void {
  counters.processed += 1;
  if (outcome === "advance" || outcome === "shortlist") counters.advanced += 1;
  else if (outcome === "watchlist") counters.watchlisted += 1;
  else if (outcome === "reject") counters.rejected += 1;
}

function isBudgetExhausted(error: unknown): boolean {
  return (
    error instanceof OpportunityIntelError && error.code === "BUDGET_EXCEEDED"
  );
}

/** Runs one stage over its eligible set. Returns true when a budget gate
 * paused the run; other per-opportunity failures are isolated into stats. */
async function runStage(input: {
  organizationId: string;
  fromStatus: "discovered" | "keyword_scanned";
  stage: "keyword" | "serp";
  cap: number;
  stats: ScanStats;
  /** Returns the gate outcome, or null when the opportunity was skipped. */
  handle: (opportunityId: string) => Promise<string | null>;
}): Promise<boolean> {
  const items = await OpportunitiesRepository.listByStatus(
    input.organizationId,
    input.fromStatus,
    input.cap,
  );
  const counters =
    input.stage === "keyword"
      ? input.stats.keywordStage
      : input.stats.serpStage;
  // Opportunities are independent (own rows, atomic budget reservations, CAS
  // status writes), so they run in a small pool. Budget exhaustion stops NEW
  // work; in-flight opportunities finish so no write is left dangling.
  const stop = { stopped: false };
  let paused = false;
  await mapWithConcurrency(
    items,
    CONCURRENCY.opportunitiesPerStage,
    async (opportunity) => {
      try {
        const outcome = await input.handle(opportunity.id);
        if (outcome !== null) bump(counters, outcome);
      } catch (error) {
        if (isBudgetExhausted(error)) {
          paused = true;
          stop.stopped = true;
          return;
        }
        counters.errors += 1;
        input.stats.errors.push({
          opportunityId: opportunity.id,
          stage: input.stage,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    stop,
  );
  return paused;
}

async function runOpportunityScan(input: {
  customer: BillingCustomerContext;
  maxOpportunities?: number;
}): Promise<{
  runId: string;
  status: "done" | "paused" | "failed";
  stats: ScanStats;
}> {
  const organizationId = input.customer.organizationId;
  const runId = await OpportunityRunsRepository.start(organizationId, "scan");
  if (!runId) {
    const active = await OpportunityRunsRepository.getRunning(
      organizationId,
      "scan",
    );
    throw new OpportunityIntelError(
      "RUN_ALREADY_ACTIVE",
      "A scan run is already active.",
      { runId: active?.id ?? null },
    );
  }
  const cap = input.maxOpportunities ?? RUN_CAPS.opportunitiesPerScan;
  const stats: ScanStats = {
    keywordStage: newCounters(),
    serpStage: newCounters(),
    errors: [],
    spendUsdByProvider: {},
  };

  try {
    // Keyword stage: DISCOVERED -> expand -> metrics -> intent + demand gate.
    let paused = await runStage({
      organizationId,
      fromStatus: "discovered",
      stage: "keyword",
      cap,
      stats,
      handle: async (opportunityId) => {
        await ExpansionService.expandOpportunityKeywords({
          organizationId,
          opportunityId,
          runId,
        });
        await MetricsService.fetchOpportunityMetrics({
          opportunityId,
          customer: input.customer,
          runId,
        });
        const result = await IntentService.classifyAndGate({
          organizationId,
          opportunityId,
          runId,
        });
        return result.outcome;
      },
    });

    // SERP stage: KEYWORD_SCANNED -> fetch -> gap analysis -> score + gate.
    if (!paused) {
      paused = await runStage({
        organizationId,
        fromStatus: "keyword_scanned",
        stage: "serp",
        cap,
        stats,
        handle: async (opportunityId) => {
          await OpportunitySerpService.fetchOpportunitySerps({
            opportunityId,
            customer: input.customer,
            runId,
          });
          await GapService.analyzeOpportunitySerps({
            organizationId,
            opportunityId,
            runId,
          });
          const result = await ScoringService.scoreAndGate({
            organizationId,
            opportunityId,
            runId,
          });
          return result.outcome === "skipped" ? null : result.outcome;
        },
      });
    }

    // Stage 8: the human deliverable. A budget-paused run skips it (the next
    // run reports); a report failure never fails the scan.
    if (!paused) {
      try {
        await ReportService.generateRunReports({ organizationId, runId });
      } catch (error) {
        if (isBudgetExhausted(error)) {
          paused = true;
        } else {
          stats.errors.push({
            opportunityId: "-",
            stage: "report",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    stats.spendUsdByProvider =
      await OpportunityCostEventsRepository.spendByProviderForDate(
        organizationId,
        todayUtc(),
      );
    const status = paused ? ("paused" as const) : ("done" as const);
    await OpportunityRunsRepository.finish(organizationId, runId, {
      status,
      stats: JSON.stringify(stats),
    });
    return { runId, status, stats };
  } catch (error) {
    await OpportunityRunsRepository.finish(organizationId, runId, {
      status: "failed",
      stats: JSON.stringify(stats),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const ScanRunner = {
  runOpportunityScan,
};
