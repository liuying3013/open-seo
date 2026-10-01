import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunityRuns } from "@/db/schema";

type RunKind = "scan" | "report";
type RunStatus = "running" | "done" | "failed" | "paused";

async function start(
  organizationId: string,
  kind: RunKind,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const inserted = await db
    .insert(opportunityRuns)
    .values({ id, organizationId, kind })
    .onConflictDoNothing()
    .returning({ id: opportunityRuns.id });
  return inserted[0]?.id ?? null;
}

async function getRunning(organizationId: string, kind: RunKind) {
  const rows = await db
    .select()
    .from(opportunityRuns)
    .where(
      and(
        eq(opportunityRuns.organizationId, organizationId),
        eq(opportunityRuns.kind, kind),
        eq(opportunityRuns.status, "running"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function finish(
  organizationId: string,
  id: string,
  input: {
    status: Exclude<RunStatus, "running">;
    stats: string;
    error?: string;
  },
): Promise<void> {
  await db
    .update(opportunityRuns)
    .set({
      status: input.status,
      stats: input.stats,
      error: input.error ?? null,
      finishedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(opportunityRuns.organizationId, organizationId),
        eq(opportunityRuns.id, id),
      ),
    );
}

async function listRecent(organizationId: string, limit = 10) {
  return db
    .select()
    .from(opportunityRuns)
    .where(eq(opportunityRuns.organizationId, organizationId))
    .orderBy(desc(opportunityRuns.startedAt))
    .limit(limit);
}

export const OpportunityRunsRepository = {
  start,
  getRunning,
  finish,
  listRecent,
};
