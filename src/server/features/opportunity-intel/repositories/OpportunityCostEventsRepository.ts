import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunityCostEvents } from "@/db/schema";

async function insert(input: {
  organizationId: string;
  provider: "dataforseo" | "openrouter";
  endpoint: string;
  requestCount: number;
  costUsd: number | null;
  opportunityId?: string | null;
  runId?: string | null;
  date: string;
}): Promise<void> {
  await db
    .insert(opportunityCostEvents)
    .values({ id: crypto.randomUUID(), ...input });
}

/** Spend per provider for one UTC day (null costs count as 0). */
async function spendByProviderForDate(
  organizationId: string,
  date: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      provider: opportunityCostEvents.provider,
      costUsd: sql<number>`coalesce(sum(${opportunityCostEvents.costUsd}), 0)`,
    })
    .from(opportunityCostEvents)
    .where(
      and(
        eq(opportunityCostEvents.organizationId, organizationId),
        eq(opportunityCostEvents.date, date),
      ),
    )
    .groupBy(opportunityCostEvents.provider);
  return Object.fromEntries(
    rows.map((row) => [row.provider, Number(row.costUsd ?? 0)]),
  );
}

export const OpportunityCostEventsRepository = {
  insert,
  spendByProviderForDate,
};
