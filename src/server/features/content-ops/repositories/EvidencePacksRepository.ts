import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { evidencePacks } from "@/db/schema";

async function getLatestForCluster(clusterId: string) {
  const rows = await db
    .select()
    .from(evidencePacks)
    .where(eq(evidencePacks.clusterId, clusterId))
    .orderBy(desc(evidencePacks.version))
    .limit(1);
  return rows[0] ?? null;
}

async function getById(projectId: string, packId: string) {
  const rows = await db
    .select()
    .from(evidencePacks)
    .where(
      and(eq(evidencePacks.id, packId), eq(evidencePacks.projectId, projectId)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function insertVersion(input: {
  projectId: string;
  clusterId: string;
  content: string;
}): Promise<{ id: string; version: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await getLatestForCluster(input.clusterId);
    const version = (latest?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const inserted = await db
      .insert(evidencePacks)
      .values({
        id,
        version,
        status: "draft",
        createdAt: now,
        updatedAt: now,
        ...input,
      })
      .onConflictDoNothing({
        target: [evidencePacks.clusterId, evidencePacks.version],
      })
      .returning({ id: evidencePacks.id });
    if (inserted.length > 0) return { id, version };
  }
  throw new Error("Evidence pack version allocation failed after 3 attempts.");
}

async function approve(projectId: string, packId: string): Promise<boolean> {
  const updated = await db
    .update(evidencePacks)
    .set({ status: "approved", updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(evidencePacks.projectId, projectId),
        eq(evidencePacks.id, packId),
        eq(evidencePacks.status, "draft"),
      ),
    )
    .returning({ id: evidencePacks.id });
  return updated.length > 0;
}

export const EvidencePacksRepository = {
  getLatestForCluster,
  getById,
  insertVersion,
  approve,
};
