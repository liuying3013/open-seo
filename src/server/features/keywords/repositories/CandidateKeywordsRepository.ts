import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import { candidateKeywords } from "@/db/schema";

const IN_LIST_CHUNK_SIZE = 90;

async function listByProject(projectId: string) {
  return db
    .select()
    .from(candidateKeywords)
    .where(eq(candidateKeywords.projectId, projectId))
    .orderBy(desc(candidateKeywords.createdAt), candidateKeywords.keyword);
}

async function saveToProject(params: {
  projectId: string;
  keywords: string[];
  locationCode: number;
  languageCode: string;
  source?: string | null;
}) {
  if (params.keywords.length === 0) return [];

  await runBatch((tx) =>
    params.keywords.map((keyword) =>
      tx
        .insert(candidateKeywords)
        .values({
          id: crypto.randomUUID(),
          projectId: params.projectId,
          keyword,
          locationCode: params.locationCode,
          languageCode: params.languageCode,
          source: params.source ?? null,
        })
        .onConflictDoNothing(),
    ),
  );

  // D1 caps a statement at 100 bound parameters, so the read-back has to be
  // chunked like the delete below — a 200-keyword save inserted fine but
  // failed here, reporting an error for a write that had succeeded.
  const rows = [];
  for (let i = 0; i < params.keywords.length; i += IN_LIST_CHUNK_SIZE) {
    rows.push(
      ...(await db
        .select()
        .from(candidateKeywords)
        .where(
          and(
            eq(candidateKeywords.projectId, params.projectId),
            eq(candidateKeywords.locationCode, params.locationCode),
            eq(candidateKeywords.languageCode, params.languageCode),
            inArray(
              candidateKeywords.keyword,
              params.keywords.slice(i, i + IN_LIST_CHUNK_SIZE),
            ),
          ),
        )),
    );
  }
  return rows;
}

async function countByProjectIds(projectIds: string[]) {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({
      projectId: candidateKeywords.projectId,
      count: sql<number>`count(*)`,
    })
    .from(candidateKeywords)
    .where(inArray(candidateKeywords.projectId, projectIds))
    .groupBy(candidateKeywords.projectId);
  return rows.map((row) => ({
    projectId: row.projectId,
    count: Number(row.count ?? 0),
  }));
}

async function remove(ids: string[], projectId: string) {
  let deletedCount = 0;
  for (let i = 0; i < ids.length; i += IN_LIST_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_LIST_CHUNK_SIZE);
    const deleted = await db
      .delete(candidateKeywords)
      .where(
        and(
          inArray(candidateKeywords.id, chunk),
          eq(candidateKeywords.projectId, projectId),
        ),
      )
      .returning({ id: candidateKeywords.id });
    deletedCount += deleted.length;
  }
  return deletedCount;
}

export const CandidateKeywordsRepository = {
  listByProject,
  saveToProject,
  countByProjectIds,
  remove,
};
