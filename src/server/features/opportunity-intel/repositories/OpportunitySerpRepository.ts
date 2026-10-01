import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches, runBatch } from "@/db/runBatch";
import {
  opportunities,
  opportunitySerpResults,
  opportunitySerpSnapshots,
  savedKeywords,
} from "@/db/schema";

type OpportunitySerpSnapshotRow = typeof opportunitySerpSnapshots.$inferSelect;
type OpportunitySerpResultRow = typeof opportunitySerpResults.$inferSelect;

type NewOpportunitySerpSnapshot = {
  opportunityId: string;
  keyword: string;
  locationCode: number;
  languageCode: string;
  device: "desktop" | "mobile";
  resultCount: number;
  /** JSON: { features: string[], relatedSearches: string[] } */
  serpFeatures: string;
  r2Key: string | null;
  results: Array<{
    rank: number;
    url: string;
    domain: string;
    title: string | null;
    description: string | null;
    resultType: string;
    platform: string | null;
  }>;
};

async function insertSnapshot(
  input: NewOpportunitySerpSnapshot,
): Promise<string> {
  const snapshotId = crypto.randomUUID();
  const fetchedAt = new Date().toISOString();
  const { results, ...snapshot } = input;
  await runBatch((tx) => [
    tx
      .insert(opportunitySerpSnapshots)
      .values({ id: snapshotId, fetchedAt, ...snapshot }),
  ]);
  await executeInBatches(results, (tx, result) =>
    tx.insert(opportunitySerpResults).values({
      id: crypto.randomUUID(),
      snapshotId,
      ...result,
    }),
  );
  return snapshotId;
}

async function listSnapshots(
  opportunityId: string,
): Promise<OpportunitySerpSnapshotRow[]> {
  return db
    .select()
    .from(opportunitySerpSnapshots)
    .where(eq(opportunitySerpSnapshots.opportunityId, opportunityId))
    .orderBy(desc(opportunitySerpSnapshots.fetchedAt));
}

async function getResults(
  snapshotIds: string[],
): Promise<OpportunitySerpResultRow[]> {
  if (snapshotIds.length === 0) return [];
  return db
    .select()
    .from(opportunitySerpResults)
    .where(inArray(opportunitySerpResults.snapshotId, snapshotIds))
    .orderBy(opportunitySerpResults.rank);
}

async function updateGap(
  snapshotId: string,
  input: { gapSignals: string; gapScore: number },
): Promise<void> {
  await db
    .update(opportunitySerpSnapshots)
    .set(input)
    .where(eq(opportunitySerpSnapshots.id, snapshotId));
}

async function updateResultPageClasses(
  updates: Array<{ resultId: string; pageClass: string }>,
): Promise<void> {
  await executeInBatches(updates, (tx, update) =>
    tx
      .update(opportunitySerpResults)
      .set({ pageClass: update.pageClass })
      .where(eq(opportunitySerpResults.id, update.resultId)),
  );
}

/**
 * The project's saved keywords that carry an archived snapshot somewhere in
 * the org's funnel — the intersection, so the list marker and its count mean
 * "this pool's keywords", not "every snapshot we ever took".
 */
async function storedKeywordKeysForProject(
  organizationId: string,
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      keyword: opportunitySerpSnapshots.keyword,
      locationCode: opportunitySerpSnapshots.locationCode,
    })
    .from(opportunitySerpSnapshots)
    .innerJoin(
      opportunities,
      eq(opportunitySerpSnapshots.opportunityId, opportunities.id),
    )
    .innerJoin(
      savedKeywords,
      and(
        eq(savedKeywords.keyword, opportunitySerpSnapshots.keyword),
        eq(savedKeywords.locationCode, opportunitySerpSnapshots.locationCode),
        eq(savedKeywords.projectId, projectId),
      ),
    )
    .where(eq(opportunities.organizationId, organizationId));
  return rows.map((row) => `${row.keyword}|${row.locationCode}`);
}

/**
 * Latest stored snapshot for one (keyword, location) anywhere in the org's
 * funnel — the read-through that lets Saved Keywords show archived SERP
 * evidence without a new API call.
 */
async function latestByKeywordForOrg(
  organizationId: string,
  keyword: string,
  locationCode: number,
): Promise<{
  snapshot: OpportunitySerpSnapshotRow;
  results: OpportunitySerpResultRow[];
} | null> {
  const rows = await db
    .select({ snapshot: opportunitySerpSnapshots })
    .from(opportunitySerpSnapshots)
    .innerJoin(
      opportunities,
      eq(opportunitySerpSnapshots.opportunityId, opportunities.id),
    )
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunitySerpSnapshots.keyword, keyword),
        eq(opportunitySerpSnapshots.locationCode, locationCode),
      ),
    )
    .orderBy(desc(opportunitySerpSnapshots.fetchedAt))
    .limit(1);
  const snapshot = rows[0]?.snapshot;
  if (!snapshot) return null;
  const results = await getResults([snapshot.id]);
  return { snapshot, results };
}

/** Latest snapshot per (keyword, location), with results — the scoring input. */
async function getLatestWithResults(opportunityId: string): Promise<
  Array<{
    snapshot: OpportunitySerpSnapshotRow;
    results: OpportunitySerpResultRow[];
  }>
> {
  const snapshots = await listSnapshots(opportunityId);
  const latest = new Map<string, OpportunitySerpSnapshotRow>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.keyword}|${snapshot.locationCode}`;
    if (!latest.has(key)) latest.set(key, snapshot);
  }
  const chosen = [...latest.values()];
  const rows = await getResults(chosen.map((snapshot) => snapshot.id));
  return chosen.map((snapshot) => ({
    snapshot,
    results: rows.filter((row) => row.snapshotId === snapshot.id),
  }));
}

/**
 * Retention: delete snapshots older than `beforeIso`, keeping the newest
 * `keepPerKey` per (opportunity, keyword, location) regardless of age.
 * Result rows cascade. Runs from the daily cron.
 */
async function pruneOlderThan(
  beforeIso: string,
  keepPerKey: number,
): Promise<number> {
  const oldSnapshots = await db
    .select({
      id: opportunitySerpSnapshots.id,
      opportunityId: opportunitySerpSnapshots.opportunityId,
      keyword: opportunitySerpSnapshots.keyword,
      locationCode: opportunitySerpSnapshots.locationCode,
    })
    .from(opportunitySerpSnapshots)
    .where(lt(opportunitySerpSnapshots.fetchedAt, beforeIso))
    .orderBy(desc(opportunitySerpSnapshots.fetchedAt));
  const seen = new Map<string, number>();
  const toDelete: string[] = [];
  for (const snapshot of oldSnapshots) {
    const key = `${snapshot.opportunityId} ${snapshot.keyword} ${snapshot.locationCode}`;
    const kept = seen.get(key) ?? 0;
    if (kept < keepPerKey) seen.set(key, kept + 1);
    else toDelete.push(snapshot.id);
  }
  if (toDelete.length > 0) {
    await executeInBatches(toDelete, (tx, id) =>
      tx
        .delete(opportunitySerpSnapshots)
        .where(eq(opportunitySerpSnapshots.id, id)),
    );
  }
  return toDelete.length;
}

/**
 * Aggressive retention for REJECTED opportunities: drop their raw result rows
 * after `beforeIso` while keeping snapshot headers (gap signals + score
 * survive as evidence). Idempotent — already-emptied snapshots match nothing.
 */
async function deleteResultsForRejectedOlderThan(
  beforeIso: string,
): Promise<number> {
  const snapshots = await db
    .select({ id: opportunitySerpSnapshots.id })
    .from(opportunitySerpSnapshots)
    .innerJoin(
      opportunities,
      eq(opportunitySerpSnapshots.opportunityId, opportunities.id),
    )
    .where(
      and(
        eq(opportunities.status, "rejected"),
        lt(opportunitySerpSnapshots.fetchedAt, beforeIso),
      ),
    );
  if (snapshots.length === 0) return 0;
  await executeInBatches(snapshots, (tx, snapshot) =>
    tx
      .delete(opportunitySerpResults)
      .where(eq(opportunitySerpResults.snapshotId, snapshot.id)),
  );
  return snapshots.length;
}

export const OpportunitySerpRepository = {
  insertSnapshot,
  listSnapshots,
  getResults,
  updateGap,
  updateResultPageClasses,
  getLatestWithResults,
  latestByKeywordForOrg,
  storedKeywordKeysForProject,
  pruneOlderThan,
  deleteResultsForRejectedOlderThan,
};
