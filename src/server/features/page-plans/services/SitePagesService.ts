import { omitBy, reverse, uniqueBy } from "remeda";
import { ProjectContextRepository } from "@/server/features/project-context/repositories/ProjectContextRepository";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { SiteRegistryRepository } from "@/server/features/site-registry/repositories/SiteRegistryRepository";
import { isUrlOnSite, normalizePageUrl, pathOfUrl } from "@/shared/pagePlans";
import { normalizeSiteDomain } from "@/shared/siteRegistry";
import type {
  ClusterTargetInput,
  ImportSitePageInput,
  ListSitePagesFilter,
} from "@/types/schemas/pagePlans";
import { PagePlanError } from "../pagePlanErrors";
import {
  SitePagesRepository,
  type NewSitePageRow,
  type SitePagePatch,
} from "../repositories/SitePagesRepository";

/** Canonical domain of the project's site, or null when none is recorded. */
export async function getProjectSiteDomain(projectId: string) {
  const [site, project] = await Promise.all([
    SiteRegistryRepository.getSiteByProjectId(projectId),
    ProjectRepository.getProjectById(projectId),
  ]);
  return normalizeSiteDomain(site?.domain ?? project?.domain ?? "");
}

const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

// Only the fields the caller sent: omitted = leave the stored value alone.
function definedFields(input: ImportSitePageInput): SitePagePatch {
  const fields: SitePagePatch = {
    language: blankToNull(input.language)?.toLowerCase(),
    routeFile: blankToNull(input.routeFile),
    contentFile: blankToNull(input.contentFile),
    title: blankToNull(input.title),
    metaDescription: blankToNull(input.metaDescription),
    h1: blankToNull(input.h1),
    canonical: blankToNull(input.canonical),
    noindex: input.noindex,
    statusCode: input.statusCode,
    pageRole: input.pageRole,
    inSitemap: input.inSitemap,
    source: input.source,
    lastCheckedAt: blankToNull(input.lastCheckedAt),
  };
  return omitBy(fields, (value) => value === undefined);
}

type ImportOptions = {
  projectId: string;
  pages: ImportSitePageInput[];
  // Pages of the project that are not in this import get in_sitemap=false.
  // Only meaningful when `pages` is the complete sitemap.
  markMissingOutOfSitemap?: boolean;
};

async function importPages({
  projectId,
  pages,
  markMissingOutOfSitemap = false,
}: ImportOptions) {
  const domain = await getProjectSiteDomain(projectId);
  const rejected: { url: string; reason: string }[] = [];
  const accepted: { url: string; input: ImportSitePageInput }[] = [];
  for (const input of pages) {
    const url = normalizePageUrl(input.url, domain);
    if (!url) {
      rejected.push({
        url: input.url,
        reason: "Not a valid URL (a bare path needs a project domain)",
      });
    } else if (domain && !isUrlOnSite(url, domain)) {
      rejected.push({ url: input.url, reason: `Not on ${domain}` });
    } else {
      accepted.push({ url, input });
    }
  }
  // The last entry wins when a URL is listed twice.
  const unique = uniqueBy(reverse(accepted), (page) => page.url);

  const [existingRows, keyPages] = await Promise.all([
    SitePagesRepository.getByUrls(
      projectId,
      unique.map((page) => page.url),
    ),
    ProjectContextRepository.listKeyPages(projectId),
  ]);
  const existingByUrl = new Map(existingRows.map((row) => [row.url, row]));
  const keyRoleByUrl = new Map<string, NewSitePageRow["pageRole"]>();
  for (const keyPage of keyPages) {
    const url = normalizePageUrl(keyPage.url, domain);
    if (url) keyRoleByUrl.set(url, keyPage.role);
  }

  const now = new Date().toISOString();
  const inserts: NewSitePageRow[] = [];
  const updates: { id: string; patch: SitePagePatch }[] = [];
  let unchanged = 0;
  for (const { url, input } of unique) {
    const fields = definedFields(input);
    if (markMissingOutOfSitemap) fields.inSitemap ??= true;
    const existing = existingByUrl.get(url);
    if (fields.pageRole === undefined && !existing?.pageRole) {
      const keyRole = keyRoleByUrl.get(url);
      if (keyRole) fields.pageRole = keyRole;
    }
    if (!existing) {
      inserts.push({
        id: crypto.randomUUID(),
        projectId,
        url,
        path: pathOfUrl(url),
        source: "sitemap",
        createdAt: now,
        updatedAt: now,
        ...fields,
      });
      continue;
    }
    const patch = omitBy(fields, (value, key) => existing[key] === value);
    if (Object.keys(patch).length === 0) {
      unchanged += 1;
    } else {
      updates.push({ id: existing.id, patch: { ...patch, updatedAt: now } });
    }
  }

  let markedOutOfSitemap = 0;
  if (markMissingOutOfSitemap) {
    const importedUrls = new Set(unique.map((page) => page.url));
    const missing = (await SitePagesRepository.listAllUrls(projectId)).filter(
      (row) => row.inSitemap && !importedUrls.has(row.url),
    );
    markedOutOfSitemap = missing.length;
    for (const row of missing) {
      updates.push({ id: row.id, patch: { inSitemap: false, updatedAt: now } });
    }
  }

  await SitePagesRepository.insertMany(inserts);
  await SitePagesRepository.updateMany(projectId, updates);
  return {
    created: inserts.length,
    updated: updates.length - markedOutOfSitemap,
    unchanged,
    markedOutOfSitemap,
    rejected,
  };
}

function list(projectId: string, filter: ListSitePagesFilter) {
  return SitePagesRepository.list(projectId, filter);
}

function listLanguages(projectId: string) {
  return SitePagesRepository.listLanguages(projectId);
}

async function setClusterTargets(
  projectId: string,
  targets: ClusterTargetInput[],
) {
  const clusterIds = [...new Set(targets.map((target) => target.clusterId))];
  const foundClusters = new Set(
    await SitePagesRepository.getExistingClusterIds(projectId, clusterIds),
  );
  const missingCluster = clusterIds.find((id) => !foundClusters.has(id));
  if (missingCluster) {
    throw new PagePlanError(
      "CLUSTER_NOT_FOUND",
      `Cluster ${missingCluster} does not belong to this project`,
    );
  }

  const pageIds = [
    ...new Set(
      targets.flatMap((target) =>
        target.targetPageId ? [target.targetPageId] : [],
      ),
    ),
  ];
  const foundPages = new Set(
    (await SitePagesRepository.getByIds(projectId, pageIds)).map(
      (page) => page.id,
    ),
  );
  const missingPage = pageIds.find((id) => !foundPages.has(id));
  if (missingPage) {
    throw new PagePlanError(
      "SITE_PAGE_NOT_FOUND",
      `Site page ${missingPage} does not belong to this project`,
    );
  }

  const domain = await getProjectSiteDomain(projectId);
  const updates = targets.map((target) => {
    let targetUrl: string | null | undefined;
    if (target.targetUrl !== undefined) {
      const raw = target.targetUrl?.trim();
      targetUrl = raw ? normalizePageUrl(raw, domain) : null;
      if (raw && !targetUrl) {
        throw new PagePlanError("INVALID_URL", `Invalid targetUrl: ${raw}`);
      }
    }
    const patch = {
      targetPageId: target.targetPageId,
      targetUrl,
      plannedAction: target.plannedAction,
      actionReason: blankToNull(target.actionReason),
    };
    return {
      clusterId: target.clusterId,
      patch: omitBy(patch, (value) => value === undefined),
    };
  });
  await SitePagesRepository.updateClusterTargets(projectId, updates);
  return { updated: updates.length };
}

export const SitePagesService = {
  importPages,
  list,
  listLanguages,
  setClusterTargets,
} as const;
