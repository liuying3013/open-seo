import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { chunk } from "remeda";
import { db } from "@/db";
import { executeInBatches } from "@/db/runBatch";
import { clusters, sitePages } from "@/db/schema";
import type { ListSitePagesFilter } from "@/types/schemas/pagePlans";

type SitePageRow = typeof sitePages.$inferSelect;
export type NewSitePageRow = typeof sitePages.$inferInsert;
export type SitePagePatch = Partial<
  Omit<NewSitePageRow, "id" | "projectId" | "url">
>;

// D1 caps a statement at 100 bound parameters, so id/url lists are chunked.
const IN_LIST_CHUNK_SIZE = 90;

async function getByUrls(projectId: string, urls: string[]) {
  const rows: SitePageRow[] = [];
  for (const urlChunk of chunk(urls, IN_LIST_CHUNK_SIZE)) {
    rows.push(
      ...(await db
        .select()
        .from(sitePages)
        .where(
          and(
            eq(sitePages.projectId, projectId),
            inArray(sitePages.url, urlChunk),
          ),
        )),
    );
  }
  return rows;
}

async function getByIds(projectId: string, ids: string[]) {
  const rows: SitePageRow[] = [];
  for (const idChunk of chunk(ids, IN_LIST_CHUNK_SIZE)) {
    rows.push(
      ...(await db
        .select()
        .from(sitePages)
        .where(
          and(
            eq(sitePages.projectId, projectId),
            inArray(sitePages.id, idChunk),
          ),
        )),
    );
  }
  return rows;
}

async function listAllUrls(projectId: string) {
  return db
    .select({
      id: sitePages.id,
      url: sitePages.url,
      inSitemap: sitePages.inSitemap,
    })
    .from(sitePages)
    .where(eq(sitePages.projectId, projectId));
}

async function insertMany(rows: NewSitePageRow[]) {
  await executeInBatches(rows, (tx, row) =>
    tx.insert(sitePages).values(row).onConflictDoNothing(),
  );
}

async function updateMany(
  projectId: string,
  updates: { id: string; patch: SitePagePatch }[],
) {
  await executeInBatches(updates, (tx, { id, patch }) =>
    tx
      .update(sitePages)
      .set(patch)
      .where(and(eq(sitePages.id, id), eq(sitePages.projectId, projectId))),
  );
}

function filterConditions(projectId: string, filter: ListSitePagesFilter) {
  const conditions = [eq(sitePages.projectId, projectId)];
  if (filter.language) conditions.push(eq(sitePages.language, filter.language));
  if (filter.statusCode !== undefined)
    conditions.push(eq(sitePages.statusCode, filter.statusCode));
  if (filter.noindex !== undefined)
    conditions.push(eq(sitePages.noindex, filter.noindex));
  if (filter.pageRole) conditions.push(eq(sitePages.pageRole, filter.pageRole));
  if (filter.inSitemap !== undefined)
    conditions.push(eq(sitePages.inSitemap, filter.inSitemap));
  if (filter.search) {
    const pattern = `%${filter.search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    const search = or(
      sql`lower(${sitePages.url}) like ${pattern} escape '\\'`,
      sql`lower(${sitePages.title}) like ${pattern} escape '\\'`,
      sql`lower(${sitePages.h1}) like ${pattern} escape '\\'`,
    );
    if (search) conditions.push(search);
  }
  return and(...conditions);
}

// Pages with the number of clusters that point at each as their target page.
async function list(projectId: string, filter: ListSitePagesFilter) {
  const where = filterConditions(projectId, filter);
  const [rows, [total]] = await Promise.all([
    db
      .select({
        page: sitePages,
        clusterCount: sql<number>`(select cast(count(*) as integer) from clusters where clusters.target_page_id = site_pages.id)`,
      })
      .from(sitePages)
      .where(where)
      .orderBy(asc(sitePages.url))
      .limit(filter.limit ?? 200)
      .offset(filter.offset ?? 0),
    db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(sitePages)
      .where(where),
  ]);
  return {
    rows: rows.map((row) => ({
      ...row.page,
      clusterCount: Number(row.clusterCount),
    })),
    total: Number(total?.count ?? 0),
  };
}

async function listLanguages(projectId: string) {
  const rows = await db
    .selectDistinct({ language: sitePages.language })
    .from(sitePages)
    .where(eq(sitePages.projectId, projectId))
    .orderBy(asc(sitePages.language));
  return rows.flatMap((row) => (row.language ? [row.language] : []));
}

async function getExistingClusterIds(projectId: string, ids: string[]) {
  const found: string[] = [];
  for (const idChunk of chunk(ids, IN_LIST_CHUNK_SIZE)) {
    const rows = await db
      .select({ id: clusters.id })
      .from(clusters)
      .where(
        and(eq(clusters.projectId, projectId), inArray(clusters.id, idChunk)),
      );
    found.push(...rows.map((row) => row.id));
  }
  return found;
}

type ClusterTargetPatch = {
  targetPageId?: string | null;
  targetUrl?: string | null;
  plannedAction?: (typeof clusters.$inferSelect)["plannedAction"];
  actionReason?: string | null;
};

async function updateClusterTargets(
  projectId: string,
  updates: { clusterId: string; patch: ClusterTargetPatch }[],
) {
  const updatedAt = new Date().toISOString();
  await executeInBatches(updates, (tx, { clusterId, patch }) =>
    tx
      .update(clusters)
      .set({ ...patch, updatedAt })
      .where(
        and(eq(clusters.id, clusterId), eq(clusters.projectId, projectId)),
      ),
  );
}

export const SitePagesRepository = {
  getByUrls,
  getByIds,
  listAllUrls,
  insertMany,
  updateMany,
  list,
  listLanguages,
  getExistingClusterIds,
  updateClusterTargets,
} as const;
