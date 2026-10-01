import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  gscConnections,
  projectMarkets,
  projects,
  projectSites,
} from "@/db/schema";

export type ProjectSiteRow = typeof projectSites.$inferSelect;
type ProjectSiteValues = typeof projectSites.$inferInsert;
export type ProjectMarketRow = typeof projectMarkets.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;

// Active projects with their (optional) registry row. Projects that were never
// registered still appear, with `site: null`.
async function listProjectsWithSites(organizationId: string) {
  return db
    .select({ project: projects, site: projectSites })
    .from(projects)
    .leftJoin(projectSites, eq(projectSites.projectId, projects.id))
    .where(
      and(
        eq(projects.organizationId, organizationId),
        isNull(projects.archivedAt),
      ),
    );
}

async function listMarkets(organizationId: string) {
  const rows = await db
    .select({ market: projectMarkets })
    .from(projectMarkets)
    .innerJoin(projects, eq(projects.id, projectMarkets.projectId))
    .where(eq(projects.organizationId, organizationId));
  return rows.map((row) => row.market);
}

async function listGscConnections(organizationId: string) {
  return db
    .select({
      projectId: gscConnections.projectId,
      siteUrl: gscConnections.siteUrl,
    })
    .from(gscConnections)
    .where(eq(gscConnections.organizationId, organizationId));
}

async function insertSite(values: ProjectSiteValues) {
  await db.insert(projectSites).values(values);
}

async function updateSite(
  projectId: string,
  values: Partial<ProjectSiteValues>,
) {
  await db
    .update(projectSites)
    .set(values)
    .where(eq(projectSites.projectId, projectId));
}

async function insertMarket(values: typeof projectMarkets.$inferInsert) {
  await db.insert(projectMarkets).values(values);
}

async function updateMarket(
  id: string,
  values: Partial<typeof projectMarkets.$inferInsert>,
) {
  await db.update(projectMarkets).set(values).where(eq(projectMarkets.id, id));
}

async function deleteMarket(id: string) {
  await db.delete(projectMarkets).where(eq(projectMarkets.id, id));
}

// Keeps projects.location_code/language_code equal to the primary market, which
// the rest of the app still reads as "the project's default market".
async function setProjectDefaultMarket(
  projectId: string,
  market: { locationCode: number; languageCode: string },
) {
  await db.update(projects).set(market).where(eq(projects.id, projectId));
}

async function setProjectDomain(projectId: string, domain: string) {
  await db.update(projects).set({ domain }).where(eq(projects.id, projectId));
}

export const SiteRegistryRepository = {
  listProjectsWithSites,
  listMarkets,
  listGscConnections,
  insertSite,
  updateSite,
  insertMarket,
  updateMarket,
  deleteMarket,
  setProjectDefaultMarket,
  setProjectDomain,
} as const;
