import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers } from "@/db/schema";

export type OfferInput = {
  id?: string;
  name: string;
  description?: string | null;
  marginTier: "high" | "mid" | "low";
  readiness: "ready" | "partial" | "none";
  marketPriority: number;
  conversionAssets?: string | null;
  notes?: string | null;
};

async function listByProject(projectId: string) {
  return db
    .select()
    .from(offers)
    .where(eq(offers.projectId, projectId))
    .orderBy(asc(offers.name));
}

async function getById(projectId: string, offerId: string) {
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.id, offerId))
    .limit(1);
  const offer = rows[0];
  return offer && offer.projectId === projectId ? offer : null;
}

// Upsert by id: rows arriving with an id update in place, the rest insert.
async function saveMany(projectId: string, inputs: OfferInput[]) {
  const now = new Date().toISOString();
  const savedIds: string[] = [];
  for (const input of inputs) {
    const { id, ...fields } = input;
    if (id) {
      await db
        .update(offers)
        .set({ ...fields, updatedAt: now })
        .where(and(eq(offers.id, id), eq(offers.projectId, projectId)));
      savedIds.push(id);
    } else {
      const newId = crypto.randomUUID();
      await db
        .insert(offers)
        .values({ id: newId, projectId, ...fields, updatedAt: now });
      savedIds.push(newId);
    }
  }
  return savedIds;
}

export const OffersRepository = {
  listByProject,
  getById,
  saveMany,
};
