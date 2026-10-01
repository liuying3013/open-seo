import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { deploymentDecisions } from "@/db/schema";

type NewDecision = {
  projectId: string;
  clusterId: string;
  moneySitePageType: string;
  /** JSON array of platform plan entries. */
  platformPlan: string;
  reasonSummary: string;
  decidedBy: "agent" | "user";
};

async function insert(input: NewDecision): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(deploymentDecisions).values({
    id,
    // Activate only after existing proposals are superseded. The partial
    // unique index guarantees concurrent decision runs cannot leave two open.
    status: "superseded",
    createdAt: new Date().toISOString(),
    ...input,
  });
  return id;
}

async function getById(projectId: string, decisionId: string) {
  const rows = await db
    .select()
    .from(deploymentDecisions)
    .where(
      and(
        eq(deploymentDecisions.id, decisionId),
        eq(deploymentDecisions.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listByCluster(clusterId: string) {
  return db
    .select()
    .from(deploymentDecisions)
    .where(eq(deploymentDecisions.clusterId, clusterId))
    .orderBy(desc(deploymentDecisions.createdAt));
}

async function update(
  decisionId: string,
  fields: Partial<{
    status: "proposed" | "approved" | "rejected" | "superseded";
    moneySitePageType: string;
    platformPlan: string;
    reasonSummary: string;
    decidedBy: "agent" | "user";
    approvedAt: string | null;
    supersededById: string | null;
  }>,
) {
  await db
    .update(deploymentDecisions)
    .set(fields)
    .where(eq(deploymentDecisions.id, decisionId));
}

async function transitionStatus(
  projectId: string,
  decisionId: string,
  from: "proposed",
  fields: Partial<{
    status: "approved" | "rejected";
    moneySitePageType: string;
    platformPlan: string;
    decidedBy: "agent" | "user";
    approvedAt: string | null;
  }> & { status: "approved" | "rejected" },
): Promise<boolean> {
  const updated = await db
    .update(deploymentDecisions)
    .set(fields)
    .where(
      and(
        eq(deploymentDecisions.projectId, projectId),
        eq(deploymentDecisions.id, decisionId),
        eq(deploymentDecisions.status, from),
      ),
    )
    .returning({ id: deploymentDecisions.id });
  return updated.length > 0;
}

/** Mark every open proposal of a cluster superseded by a newer decision. */
async function supersedeOpenProposals(clusterId: string, byDecisionId: string) {
  await db
    .update(deploymentDecisions)
    .set({ status: "superseded", supersededById: byDecisionId })
    .where(
      and(
        eq(deploymentDecisions.clusterId, clusterId),
        eq(deploymentDecisions.status, "proposed"),
      ),
    );
}

export const DecisionsRepository = {
  insert,
  getById,
  listByCluster,
  update,
  transitionStatus,
  supersedeOpenProposals,
};
