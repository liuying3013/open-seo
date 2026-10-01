import { OpportunityIntelError } from "../opportunityIntelErrors";
import {
  DAILY_BUDGET_LIMITS,
  ENDPOINT_BUDGET_KIND,
  ESTIMATED_COST_USD,
  type CostEndpoint,
} from "../rules/scoringRules";
import { OpportunityCostEventsRepository } from "../repositories/OpportunityCostEventsRepository";
import { OpportunityBudgetsRepository } from "../repositories/OpportunityBudgetsRepository";

// The discovery funnel's runaway guard AND its cost ledger (PRD §29) in one
// seam: every charged call checks today's ledger aggregates BEFORE running
// (fail closed) and appends an event after. There is no separate budgets
// table — the ledger is the budget source of truth.

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function checkDailyBudget(
  organizationId: string,
  endpoint: CostEndpoint,
  amount = 1,
): Promise<void> {
  const kind = ENDPOINT_BUDGET_KIND[endpoint];
  const limit = DAILY_BUDGET_LIMITS[kind];
  const date = todayUtc();
  const ok = await OpportunityBudgetsRepository.tryConsume({
    organizationId,
    date,
    kind,
    amount,
    limit,
  });
  if (!ok) {
    const day = await OpportunityBudgetsRepository.getDay(organizationId, date);
    const used = day?.[kind] ?? 0;
    throw new OpportunityIntelError(
      "BUDGET_EXCEEDED",
      `Daily ${kind} budget exhausted (${used}/${limit} requests used, ${amount} requested). ` +
        `The scan run pauses and resumes within tomorrow's allowance.`,
      { kind, endpoint, used, limit, requested: amount, date },
    );
  }
}

export async function recordCostEvent(input: {
  organizationId: string;
  provider: "dataforseo" | "openrouter";
  endpoint: CostEndpoint;
  requestCount?: number;
  /** Provider-reported cost; falls back to the rules-module estimate. */
  costUsd?: number | null;
  opportunityId?: string | null;
  runId?: string | null;
}): Promise<void> {
  const requestCount = input.requestCount ?? 1;
  const estimate = ESTIMATED_COST_USD[input.endpoint];
  await OpportunityCostEventsRepository.insert({
    organizationId: input.organizationId,
    provider: input.provider,
    endpoint: input.endpoint,
    requestCount,
    costUsd:
      input.costUsd ??
      (estimate !== undefined ? estimate * requestCount : null),
    opportunityId: input.opportunityId ?? null,
    runId: input.runId ?? null,
    date: todayUtc(),
  });
}
