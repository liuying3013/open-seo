import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projects, siteChangeAlerts } from "@/db/schema";

type NewAlert = {
  commitSha: string;
  author: string | null;
  message: string | null;
};

// Returns the shas that were actually new; known commits are left untouched.
async function insertMany(projectId: string, alerts: NewAlert[]) {
  const detectedAt = new Date().toISOString();
  const inserted: string[] = [];
  for (const alert of alerts) {
    const rows = await db
      .insert(siteChangeAlerts)
      .values({ id: crypto.randomUUID(), projectId, detectedAt, ...alert })
      .onConflictDoNothing({
        target: [siteChangeAlerts.projectId, siteChangeAlerts.commitSha],
      })
      .returning({ commitSha: siteChangeAlerts.commitSha });
    if (rows.length > 0) inserted.push(alert.commitSha);
  }
  return inserted;
}

async function listOpen(projectId: string) {
  return db
    .select()
    .from(siteChangeAlerts)
    .where(
      and(
        eq(siteChangeAlerts.projectId, projectId),
        isNull(siteChangeAlerts.resolvedAt),
      ),
    )
    .orderBy(desc(siteChangeAlerts.detectedAt));
}

async function resolve(projectId: string, alertId: string, userId: string) {
  const rows = await db
    .update(siteChangeAlerts)
    .set({ resolvedAt: new Date().toISOString(), resolvedByUserId: userId })
    .where(
      and(
        eq(siteChangeAlerts.id, alertId),
        eq(siteChangeAlerts.projectId, projectId),
        isNull(siteChangeAlerts.resolvedAt),
      ),
    )
    .returning({ id: siteChangeAlerts.id });
  return rows.length > 0;
}

async function countOpenByProject(organizationId: string) {
  const rows = await db
    .select({ projectId: siteChangeAlerts.projectId })
    .from(siteChangeAlerts)
    .innerJoin(projects, eq(projects.id, siteChangeAlerts.projectId))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNull(siteChangeAlerts.resolvedAt),
      ),
    );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.projectId] = (counts[row.projectId] ?? 0) + 1;
  }
  return counts;
}

export const SiteChangeAlertsRepository = {
  insertMany,
  listOpen,
  resolve,
  countOpenByProject,
};
