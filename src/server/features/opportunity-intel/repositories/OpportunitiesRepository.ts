import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import type { IpRisk, OpportunityType } from "../rules/scoringRules";
import type { OpportunityStatus } from "../stateMachine";

export type OpportunityRow = typeof opportunities.$inferSelect;

type NewOpportunity = {
  organizationId: string;
  name: string;
  normalizedName: string;
  type: OpportunityType;
  source?: string;
  seedNotes?: string | null;
  description?: string | null;
  /** ISO short country codes, e.g. ["US", "UK"]. Stored as JSON. */
  targetCountries: string[];
  languageCode: string;
  ipRisk: IpRisk;
  estimatedUnitPriceUsd?: number | null;
  nameZh?: string | null;
};

async function insert(input: NewOpportunity): Promise<string | null> {
  const id = crypto.randomUUID();
  const { targetCountries, ...fields } = input;
  const inserted = await db
    .insert(opportunities)
    .values({
      id,
      ...fields,
      targetCountries: JSON.stringify(targetCountries),
      statusChangedAt: new Date().toISOString(),
    })
    .onConflictDoNothing({
      target: [opportunities.organizationId, opportunities.normalizedName],
    })
    .returning({ id: opportunities.id });
  return inserted[0]?.id ?? null;
}

async function getById(
  organizationId: string,
  id: string,
): Promise<OpportunityRow | null> {
  const rows = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getByNormalizedName(
  organizationId: string,
  normalizedName: string,
): Promise<OpportunityRow | null> {
  const rows = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.normalizedName, normalizedName),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** The batch runner's work selection: oldest-first within a stage. */
async function listByStatus(
  organizationId: string,
  status: OpportunityStatus,
  limit: number,
): Promise<OpportunityRow[]> {
  return db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.status, status),
      ),
    )
    .orderBy(asc(opportunities.statusChangedAt), asc(opportunities.createdAt))
    .limit(limit);
}

async function listByStatuses(
  organizationId: string,
  statuses: OpportunityStatus[],
  limit = 200,
): Promise<OpportunityRow[]> {
  if (statuses.length === 0) return [];
  return db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        inArray(opportunities.status, statuses),
      ),
    )
    .orderBy(desc(opportunities.statusChangedAt))
    .limit(limit);
}

async function countsByStatus(
  organizationId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: opportunities.status,
      count: sql<number>`count(*)`,
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId))
    .groupBy(opportunities.status);
  return Object.fromEntries(
    rows.map((row) => [row.status, Number(row.count ?? 0)]),
  );
}

/** Callers assert the transition (stateMachine) BEFORE writing. */
async function updateStatus(
  organizationId: string,
  id: string,
  from: OpportunityStatus,
  status: OpportunityStatus,
  graduatedProjectId?: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const conditions = [
    eq(opportunities.organizationId, organizationId),
    eq(opportunities.id, id),
    eq(opportunities.status, from),
  ];
  if (status === "graduated" && graduatedProjectId) {
    conditions.push(eq(opportunities.graduatedProjectId, graduatedProjectId));
  } else if (status !== "graduated") {
    conditions.push(isNull(opportunities.graduatedProjectId));
  }
  const updated = await db
    .update(opportunities)
    .set({ status, statusChangedAt: now, updatedAt: now })
    .where(and(...conditions))
    .returning({ id: opportunities.id });
  return updated.length > 0;
}

async function claimGraduation(
  organizationId: string,
  id: string,
  projectId: string,
): Promise<"claimed" | "resume" | "conflict"> {
  const updated = await db
    .update(opportunities)
    .set({
      graduatedProjectId: projectId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, id),
        eq(opportunities.status, "shortlisted"),
        isNull(opportunities.graduatedProjectId),
      ),
    )
    .returning({ id: opportunities.id });
  if (updated.length > 0) return "claimed";
  const current = await getById(organizationId, id);
  return current?.status === "shortlisted" &&
    current.graduatedProjectId === projectId
    ? "resume"
    : "conflict";
}

async function updateFields(
  organizationId: string,
  id: string,
  fields: Partial<
    Pick<
      OpportunityRow,
      | "description"
      | "ipRisk"
      | "latestScore"
      | "latestConfidence"
      | "latestScoreVersion"
      | "graduatedProjectId"
    >
  >,
): Promise<void> {
  await db
    .update(opportunities)
    .set({ ...fields, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.id, id),
      ),
    );
}

export const OpportunitiesRepository = {
  insert,
  getById,
  getByNormalizedName,
  listByStatus,
  listByStatuses,
  countsByStatus,
  updateStatus,
  claimGraduation,
  updateFields,
};
