import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunityReports } from "@/db/schema";

type OpportunityReportRow = typeof opportunityReports.$inferSelect;

async function insert(input: {
  organizationId: string;
  kind: "daily" | "detail";
  reportDate: string;
  opportunityId?: string | null;
  runId?: string | null;
  title: string;
  content: string;
  data: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(opportunityReports).values({ id, ...input });
  return id;
}

async function latestDaily(
  organizationId: string,
): Promise<OpportunityReportRow | null> {
  const rows = await db
    .select()
    .from(opportunityReports)
    .where(
      and(
        eq(opportunityReports.organizationId, organizationId),
        eq(opportunityReports.kind, "daily"),
      ),
    )
    .orderBy(desc(opportunityReports.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function latestDetailFor(
  organizationId: string,
  opportunityId: string,
): Promise<OpportunityReportRow | null> {
  const rows = await db
    .select()
    .from(opportunityReports)
    .where(
      and(
        eq(opportunityReports.organizationId, organizationId),
        eq(opportunityReports.kind, "detail"),
        eq(opportunityReports.opportunityId, opportunityId),
      ),
    )
    .orderBy(desc(opportunityReports.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function getById(
  organizationId: string,
  id: string,
): Promise<OpportunityReportRow | null> {
  const rows = await db
    .select()
    .from(opportunityReports)
    .where(
      and(
        eq(opportunityReports.organizationId, organizationId),
        eq(opportunityReports.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listRecent(
  organizationId: string,
  limit = 20,
): Promise<OpportunityReportRow[]> {
  return db
    .select()
    .from(opportunityReports)
    .where(eq(opportunityReports.organizationId, organizationId))
    .orderBy(desc(opportunityReports.createdAt))
    .limit(limit);
}

export const OpportunityReportsRepository = {
  insert,
  latestDaily,
  latestDetailFor,
  getById,
  listRecent,
};
