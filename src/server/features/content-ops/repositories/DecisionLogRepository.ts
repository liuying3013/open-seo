import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { decisionLog } from "@/db/schema";

type DecisionLogEntry = {
  projectId: string;
  clusterId?: string | null;
  decisionType:
    | "clustering"
    | "entity_disambiguation"
    | "pre_score"
    | "scoring"
    | "page_type"
    | "platform_plan"
    | "brief"
    | "other";
  /** JSON string of the data considered at decision time. */
  inputSnapshot?: string | null;
  /** JSON or prose of what was decided. */
  decision: string;
  reasonSummary?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  ruleVersion?: string | null;
  confidence?: number | null;
  createdBy: "agent" | "user" | "system";
};

// Append-only by construction: this repository exposes no update or delete.
async function append(entry: DecisionLogEntry): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(decisionLog).values({
    id,
    ...entry,
    createdAt: new Date().toISOString(),
  });
  return id;
}

async function listByCluster(clusterId: string, limit = 50) {
  return db
    .select()
    .from(decisionLog)
    .where(eq(decisionLog.clusterId, clusterId))
    .orderBy(desc(decisionLog.createdAt))
    .limit(limit);
}

async function listByProject(projectId: string, limit = 100) {
  return db
    .select()
    .from(decisionLog)
    .where(eq(decisionLog.projectId, projectId))
    .orderBy(desc(decisionLog.createdAt))
    .limit(limit);
}

export const DecisionLogRepository = {
  append,
  listByCluster,
  listByProject,
};
