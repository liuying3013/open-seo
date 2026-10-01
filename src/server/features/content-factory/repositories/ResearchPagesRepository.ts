import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { researchPages } from "@/db/schema";

type NewResearchPage = {
  fetchedAt?: string;
  projectId: string;
  clusterId: string | null;
  serpResultId: string | null;
  url: string;
  domain: string;
  fetchMethod: "read_pages" | "dataforseo_parsing";
  fetchStatus:
    | "ok"
    | "blocked"
    | "timeout"
    | "empty"
    | "not_html"
    | "robots_denied";
  httpStatus: number | null;
  title: string | null;
  bodyText: string | null;
  objectKey: string | null;
  contentHash: string | null;
  wordCount: number | null;
};

async function insertPage(input: NewResearchPage): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(researchPages)
    .values({ id, fetchedAt: new Date().toISOString(), ...input });
  return id;
}

/**
 * Bodies fetched for `urls` since `sinceIso`, newest first per URL. Used to
 * skip refetching a page we already read recently (specs/0013 section 12).
 */
async function getFreshByUrls(input: {
  projectId: string;
  urls: string[];
  sinceIso: string;
}) {
  if (input.urls.length === 0) return new Map<string, ResearchPageRow>();
  const rows = await db
    .select()
    .from(researchPages)
    .where(
      and(
        eq(researchPages.projectId, input.projectId),
        inArray(researchPages.url, input.urls),
        gte(researchPages.fetchedAt, input.sinceIso),
        eq(researchPages.fetchStatus, "ok"),
      ),
    )
    .orderBy(desc(researchPages.fetchedAt));
  const newest = new Map<string, ResearchPageRow>();
  for (const row of rows) {
    if (!newest.has(row.url)) newest.set(row.url, row);
  }
  return newest;
}

/** Newest attempt per URL for a cluster, successes and failures alike. */
async function getLatestForCluster(clusterId: string) {
  const rows = await db
    .select()
    .from(researchPages)
    .where(eq(researchPages.clusterId, clusterId))
    .orderBy(desc(researchPages.fetchedAt));
  const newest = new Map<string, ResearchPageRow>();
  for (const row of rows) {
    if (!newest.has(row.url)) newest.set(row.url, row);
  }
  return [...newest.values()];
}

/**
 * Retention: delete bodies older than `beforeIso`, keeping the newest
 * `keepPerUrl` per (project, url) regardless of age. Runs from the daily cron,
 * mirroring the SERP snapshot policy. Knowledge entries are never pruned — only
 * the raw bodies they were extracted from.
 */
async function pruneOlderThan(beforeIso: string, keepPerUrl: number) {
  const old = await db
    .select({
      id: researchPages.id,
      projectId: researchPages.projectId,
      url: researchPages.url,
    })
    .from(researchPages)
    .where(lt(researchPages.fetchedAt, beforeIso))
    .orderBy(desc(researchPages.fetchedAt));
  const seen = new Map<string, number>();
  const toDelete: string[] = [];
  for (const row of old) {
    const key = `${row.projectId} ${row.url}`;
    const kept = seen.get(key) ?? 0;
    if (kept < keepPerUrl) seen.set(key, kept + 1);
    else toDelete.push(row.id);
  }
  if (toDelete.length > 0) {
    await executeInBatches(toDelete, (tx, id) =>
      tx.delete(researchPages).where(eq(researchPages.id, id)),
    );
  }
  return toDelete.length;
}

type ResearchPageRow = typeof researchPages.$inferSelect;

export const ResearchPagesRepository = {
  insertPage,
  getFreshByUrls,
  getLatestForCluster,
  pruneOlderThan,
};
