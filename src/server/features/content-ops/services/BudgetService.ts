import { ContentOpsError } from "../contentOpsErrors";
import {
  BUDGET_KINDS,
  DAILY_BUDGET_LIMITS,
  formatBudgetUsage,
  type BudgetKind,
} from "../rules/scoringRules";
import { BudgetsRepository } from "../repositories/BudgetsRepository";

// The runaway-loop guard. Every charged content-ops operation calls consume()
// BEFORE doing the work and fails closed at the daily limit — an agent loop
// that goes off the rails stops spending within one day's allowance.

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function consume(
  projectId: string,
  kind: BudgetKind,
  amount = 1,
): Promise<void> {
  const limit = DAILY_BUDGET_LIMITS[kind];
  const date = todayUtc();
  const ok = await BudgetsRepository.tryConsume({
    projectId,
    date,
    kind,
    amount,
    limit,
  });
  if (!ok) {
    const day = await BudgetsRepository.getDay(projectId, date);
    const used = day?.[kind] ?? 0;
    throw new ContentOpsError(
      "BUDGET_EXCEEDED",
      `Daily ${kind} budget exhausted (${formatBudgetUsage(used, limit)} used, ${amount} requested). ` +
        `Resets at 00:00 UTC. Ask the user before raising limits.`,
      { kind, used, limit, requested: amount, date },
    );
  }
}

/** Today's usage vs limits, for the pipeline status tool. */
async function getToday(projectId: string) {
  const date = todayUtc();
  const day = await BudgetsRepository.getDay(projectId, date);
  return {
    date,
    usage: Object.fromEntries(
      BUDGET_KINDS.map((kind) => [
        kind,
        { used: day?.[kind] ?? 0, limit: DAILY_BUDGET_LIMITS[kind] },
      ]),
    ),
  };
}

export const BudgetService = {
  consume,
  getToday,
};
