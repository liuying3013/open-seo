import { and, asc, desc, eq, inArray } from "drizzle-orm";

// D1 caps a statement at 100 bound parameters; every IN (...) over caller-
// supplied ids goes through here so an 18-cluster save does not blow up on
// "too many SQL variables".
const IN_LIST_CHUNK_SIZE = 90;
function chunkRows<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
async function inChunks<T, R>(
  ids: T[],
  query: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const rows: R[] = [];
  for (let i = 0; i < ids.length; i += IN_LIST_CHUNK_SIZE) {
    rows.push(...(await query(ids.slice(i, i + IN_LIST_CHUNK_SIZE))));
  }
  return rows;
}
import { db } from "@/db";
import { runBatch } from "@/db/runBatch";
import {
  candidateKeywords,
  clusterKeywords,
  clusters,
  keywordMetrics,
} from "@/db/schema";
import type { ClusterStatus } from "../stateMachine";

export type NewClusterInput = {
  name: string;
  offerId?: string | null;
  primaryEntity?: string | null;
  entityCategory?: string | null;
  userJob?: string | null;
  candidateKeywordIds: string[];
  representativeCandidateKeywordIds: string[];
};

type ClusterScoreUpdate = {
  offerId?: string | null;
  intentVector?: string | null;
  serpFormatScores?: string | null;
  platformAcceptance?: string | null;
  businessValueScore?: number | null;
  businessValueBreakdown?: string | null;
  scoredAt?: string | null;
  ruleVersion?: string | null;
  entityCategory?: string | null;
  userJob?: string | null;
};

async function listByProject(projectId: string, status?: ClusterStatus) {
  return db
    .select()
    .from(clusters)
    .where(
      status
        ? and(eq(clusters.projectId, projectId), eq(clusters.status, status))
        : eq(clusters.projectId, projectId),
    )
    .orderBy(desc(clusters.businessValueScore), asc(clusters.name));
}

async function getById(projectId: string, clusterId: string) {
  const rows = await db
    .select()
    .from(clusters)
    .where(eq(clusters.id, clusterId))
    .limit(1);
  const cluster = rows[0];
  return cluster && cluster.projectId === projectId ? cluster : null;
}

/** Keywords of a cluster with their candidate row + cached metrics. */
async function getKeywords(clusterId: string) {
  return db
    .select({
      membershipId: clusterKeywords.id,
      isRepresentative: clusterKeywords.isRepresentative,
      candidateKeywordId: candidateKeywords.id,
      keyword: candidateKeywords.keyword,
      locationCode: candidateKeywords.locationCode,
      languageCode: candidateKeywords.languageCode,
      source: candidateKeywords.source,
      searchVolume: keywordMetrics.searchVolume,
      cpc: keywordMetrics.cpc,
      keywordDifficulty: keywordMetrics.keywordDifficulty,
      intent: keywordMetrics.intent,
    })
    .from(clusterKeywords)
    .innerJoin(
      candidateKeywords,
      eq(clusterKeywords.candidateKeywordId, candidateKeywords.id),
    )
    .leftJoin(
      keywordMetrics,
      and(
        eq(keywordMetrics.projectId, candidateKeywords.projectId),
        eq(keywordMetrics.keyword, candidateKeywords.keyword),
        eq(keywordMetrics.locationCode, candidateKeywords.locationCode),
        eq(keywordMetrics.languageCode, candidateKeywords.languageCode),
      ),
    )
    .where(eq(clusterKeywords.clusterId, clusterId))
    .orderBy(
      desc(clusterKeywords.isRepresentative),
      asc(candidateKeywords.keyword),
    );
}

/** Candidate keywords (with metrics) for a project that are not yet in any cluster. */
async function getUnclusteredCandidateKeywords(
  projectId: string,
  candidateKeywordIds?: string[],
) {
  // The optional id filter is applied in memory: a project's candidate list
  // is small, and an IN (...) over hundreds of ids exceeds D1's parameter cap.
  const wanted =
    candidateKeywordIds && candidateKeywordIds.length > 0
      ? new Set(candidateKeywordIds)
      : null;
  const rows = await db
    .select({
      id: candidateKeywords.id,
      keyword: candidateKeywords.keyword,
      locationCode: candidateKeywords.locationCode,
      languageCode: candidateKeywords.languageCode,
      source: candidateKeywords.source,
      searchVolume: keywordMetrics.searchVolume,
      cpc: keywordMetrics.cpc,
      keywordDifficulty: keywordMetrics.keywordDifficulty,
      intent: keywordMetrics.intent,
      clusterMembershipId: clusterKeywords.id,
    })
    .from(candidateKeywords)
    .leftJoin(
      clusterKeywords,
      eq(clusterKeywords.candidateKeywordId, candidateKeywords.id),
    )
    .leftJoin(
      keywordMetrics,
      and(
        eq(keywordMetrics.projectId, candidateKeywords.projectId),
        eq(keywordMetrics.keyword, candidateKeywords.keyword),
        eq(keywordMetrics.locationCode, candidateKeywords.locationCode),
        eq(keywordMetrics.languageCode, candidateKeywords.languageCode),
      ),
    )
    .where(eq(candidateKeywords.projectId, projectId))
    .orderBy(asc(candidateKeywords.keyword));
  return rows.filter(
    (row) =>
      row.clusterMembershipId === null &&
      (wanted === null || wanted.has(row.id)),
  );
}

/** Which of the given candidate keywords are already claimed by a cluster. */
async function findExistingMemberships(candidateKeywordIds: string[]) {
  return inChunks(candidateKeywordIds, (chunk) =>
    db
      .select({
        candidateKeywordId: clusterKeywords.candidateKeywordId,
        clusterId: clusterKeywords.clusterId,
      })
      .from(clusterKeywords)
      .where(inArray(clusterKeywords.candidateKeywordId, chunk)),
  );
}

/**
 * Insert clusters + memberships atomically. The unique index on
 * candidate_keyword_id makes a concurrent double-claim fail the whole batch,
 * which is the desired outcome (the caller re-reads and retries).
 */
async function insertClusters(projectId: string, inputs: NewClusterInput[]) {
  const now = new Date().toISOString();
  const prepared = inputs.map((input) => ({
    id: crypto.randomUUID(),
    input,
  }));
  const clusterRows = prepared.map(({ id, input }) => ({
    id,
    projectId,
    offerId: input.offerId ?? null,
    name: input.name,
    primaryEntity: input.primaryEntity ?? null,
    entityCategory: input.entityCategory ?? null,
    userJob: input.userJob ?? null,
    status: "new" as const,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  const keywordRows = prepared.flatMap(({ id, input }) =>
    input.candidateKeywordIds.map((candidateKeywordId) => ({
      id: crypto.randomUUID(),
      clusterId: id,
      candidateKeywordId,
      isRepresentative:
        input.representativeCandidateKeywordIds.includes(candidateKeywordId),
      createdAt: now,
    })),
  );
  // Multi-row INSERTs are split so no statement carries more than ~100
  // bound parameters (11 columns per cluster row, 5 per keyword row).
  await runBatch((tx) => [
    ...chunkRows(clusterRows, 8).map((rows) =>
      tx.insert(clusters).values(rows),
    ),
    ...chunkRows(keywordRows, 18).map((rows) =>
      tx.insert(clusterKeywords).values(rows),
    ),
  ]);
  return prepared.map(({ id }) => id);
}

async function transitionStatus(
  projectId: string,
  clusterId: string,
  from: ClusterStatus,
  to: ClusterStatus,
): Promise<boolean> {
  const now = new Date().toISOString();
  const updated = await db
    .update(clusters)
    .set({ status: to, statusChangedAt: now, updatedAt: now })
    .where(
      and(
        eq(clusters.projectId, projectId),
        eq(clusters.id, clusterId),
        eq(clusters.status, from),
      ),
    )
    .returning({ id: clusters.id });
  return updated.length > 0;
}

async function updateScores(clusterId: string, update: ClusterScoreUpdate) {
  await db
    .update(clusters)
    .set({ ...update, updatedAt: new Date().toISOString() })
    .where(eq(clusters.id, clusterId));
}

async function setRepresentatives(
  clusterId: string,
  representativeCandidateKeywordIds: string[],
) {
  await runBatch((tx) => [
    tx
      .update(clusterKeywords)
      .set({ isRepresentative: false })
      .where(eq(clusterKeywords.clusterId, clusterId)),
    tx
      .update(clusterKeywords)
      .set({ isRepresentative: true })
      .where(
        and(
          eq(clusterKeywords.clusterId, clusterId),
          inArray(
            clusterKeywords.candidateKeywordId,
            representativeCandidateKeywordIds,
          ),
        ),
      ),
  ]);
}

/** Counts by status for the pipeline overview. */
async function countByStatus(projectId: string) {
  const rows = await db
    .select({ status: clusters.status, id: clusters.id })
    .from(clusters)
    .where(eq(clusters.projectId, projectId));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

export const ClustersRepository = {
  listByProject,
  getById,
  getKeywords,
  getUnclusteredCandidateKeywords,
  findExistingMemberships,
  insertClusters,
  transitionStatus,
  updateScores,
  setRepresentatives,
  countByStatus,
};
