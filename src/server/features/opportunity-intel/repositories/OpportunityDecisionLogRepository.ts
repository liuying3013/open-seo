import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunityDecisionLog } from "@/db/schema";

type DecisionLogEntry = {
  opportunityId: string;
  decisionType:
    | "intake"
    | "keyword_expansion"
    | "intent_classification"
    | "serp_gap_analysis"
    | "scoring"
    | "gate_transition"
    | "report"
    | "review"
    | "graduation";
  /** JSON string of the data considered at decision time. */
  inputSnapshot?: string | null;
  /** JSON or prose of what was decided. */
  decision: string;
  reasonSummary?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  ruleVersion?: string | null;
  confidence?: number | null;
  createdBy: "system" | "user" | "agent";
};

// Append-only by construction: this repository exposes no update or delete.
async function append(entry: DecisionLogEntry): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(opportunityDecisionLog).values({
    id,
    ...entry,
    createdAt: new Date().toISOString(),
  });
  return id;
}

async function listByOpportunity(opportunityId: string, limit = 100) {
  return db
    .select()
    .from(opportunityDecisionLog)
    .where(eq(opportunityDecisionLog.opportunityId, opportunityId))
    .orderBy(desc(opportunityDecisionLog.createdAt))
    .limit(limit);
}

export const OpportunityDecisionLogRepository = {
  append,
  listByOpportunity,
};
