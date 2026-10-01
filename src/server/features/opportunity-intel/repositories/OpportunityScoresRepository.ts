import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunityScores } from "@/db/schema";

/** History kept: one row per compute — re-scoring is an insert, never an update. */
async function insert(input: {
  opportunityId: string;
  stage: "keyword" | "serp";
  score: number;
  confidence: number;
  scoreVersion: string;
  /** JSON string breakdown (inputs, subscores, renormalization, adjustment). */
  breakdown: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(opportunityScores).values({ id, ...input });
  return id;
}

async function listByOpportunity(opportunityId: string, limit = 20) {
  return db
    .select()
    .from(opportunityScores)
    .where(eq(opportunityScores.opportunityId, opportunityId))
    .orderBy(desc(opportunityScores.createdAt))
    .limit(limit);
}

export const OpportunityScoresRepository = {
  insert,
  listByOpportunity,
};
