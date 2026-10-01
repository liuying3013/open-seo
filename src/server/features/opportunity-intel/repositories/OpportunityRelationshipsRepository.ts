import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { opportunityRelationships } from "@/db/schema";

type Relation = "parent" | "derived_from" | "similar_to";

/** Idempotent: the (from, to, relation) unique index absorbs duplicates. */
async function insert(input: {
  fromOpportunityId: string;
  toOpportunityId: string;
  relation: Relation;
}): Promise<void> {
  await db
    .insert(opportunityRelationships)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing();
}

async function listFor(opportunityId: string) {
  return db
    .select()
    .from(opportunityRelationships)
    .where(
      or(
        eq(opportunityRelationships.fromOpportunityId, opportunityId),
        eq(opportunityRelationships.toOpportunityId, opportunityId),
      ),
    );
}

export const OpportunityRelationshipsRepository = {
  insert,
  listFor,
};
