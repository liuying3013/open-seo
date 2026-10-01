import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunityBudgets } from "@/db/schema";

export type OpportunityBudgetKind =
  | "llmCalls"
  | "keywordLookups"
  | "serpFetches";

const COLUMN_BY_KIND = {
  llmCalls: opportunityBudgets.llmCalls,
  keywordLookups: opportunityBudgets.keywordLookups,
  serpFetches: opportunityBudgets.serpFetches,
} as const;

/** Atomically reserve provider requests without exceeding the daily cap. */
async function tryConsume(input: {
  organizationId: string;
  date: string;
  kind: OpportunityBudgetKind;
  amount: number;
  limit: number;
}): Promise<boolean> {
  const column = COLUMN_BY_KIND[input.kind];
  await db
    .insert(opportunityBudgets)
    .values({ organizationId: input.organizationId, date: input.date })
    .onConflictDoNothing({
      target: [opportunityBudgets.organizationId, opportunityBudgets.date],
    });
  const updated = await db
    .update(opportunityBudgets)
    .set({ [input.kind]: sql`${column} + ${input.amount}` })
    .where(
      and(
        eq(opportunityBudgets.organizationId, input.organizationId),
        eq(opportunityBudgets.date, input.date),
        sql`${column} + ${input.amount} <= ${input.limit}`,
      ),
    )
    .returning({ organizationId: opportunityBudgets.organizationId });
  return updated.length > 0;
}

async function getDay(organizationId: string, date: string) {
  const rows = await db
    .select()
    .from(opportunityBudgets)
    .where(
      and(
        eq(opportunityBudgets.organizationId, organizationId),
        eq(opportunityBudgets.date, date),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export const OpportunityBudgetsRepository = { tryConsume, getDay };
