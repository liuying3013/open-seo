import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { contentBudgets } from "@/db/schema";
import type { BudgetKind } from "../rules/scoringRules";

const COLUMN_BY_KIND = {
  serpFetches: contentBudgets.serpFetches,
  llmCalls: contentBudgets.llmCalls,
  briefsGenerated: contentBudgets.briefsGenerated,
  pageReads: contentBudgets.pageReads,
} as const;

async function getDay(projectId: string, date: string) {
  const rows = await db
    .select()
    .from(contentBudgets)
    .where(
      and(
        eq(contentBudgets.projectId, projectId),
        eq(contentBudgets.date, date),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atomically consume `amount` units of `kind` for the day. When `limit` is a
 * number, the increment is rejected (returns false, consumes nothing) if it
 * would exceed — fail-closed, inside the UPDATE WHERE so concurrent consumers
 * cannot jointly overshoot. `limit: null` increments with no cap.
 */
async function tryConsume(input: {
  projectId: string;
  date: string;
  kind: BudgetKind;
  amount: number;
  limit: number | null;
}): Promise<boolean> {
  const column = COLUMN_BY_KIND[input.kind];
  await db
    .insert(contentBudgets)
    .values({ projectId: input.projectId, date: input.date })
    .onConflictDoNothing({
      target: [contentBudgets.projectId, contentBudgets.date],
    });
  const identity = and(
    eq(contentBudgets.projectId, input.projectId),
    eq(contentBudgets.date, input.date),
  );
  const cap =
    input.limit === null
      ? identity
      : and(identity, sql`${column} + ${input.amount} <= ${input.limit}`);
  const updated = await db
    .update(contentBudgets)
    .set({ [input.kind]: sql`${column} + ${input.amount}` })
    .where(cap)
    .returning({ projectId: contentBudgets.projectId });
  return updated.length > 0;
}

export const BudgetsRepository = {
  getDay,
  tryConsume,
};
