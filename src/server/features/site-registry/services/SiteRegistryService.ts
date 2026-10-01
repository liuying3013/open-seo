import { omitBy, pick, sortBy } from "remeda";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import {
  SiteRegistryRepository,
  type ProjectMarketRow,
  type ProjectRow,
  type ProjectSiteRow,
} from "@/server/features/site-registry/repositories/SiteRegistryRepository";
import { AppError } from "@/server/lib/errors";
import { assertLanguageForLocation } from "@/server/lib/market";
import { normalizeSiteDomain } from "@/shared/siteRegistry";
import type {
  ImportSiteInput,
  SiteMarketInput,
  UpdateSiteRowInput,
} from "@/types/schemas/siteRegistry";

const REGISTRY_KEYS = [
  "businessGroup",
  "brand",
  "siteRole",
  "opsStatus",
  "githubRepo",
  "productionBranch",
  "hosting",
  "coolifyAppUuid",
  "coolifyServer",
  "autoDeploy",
  "templateFamily",
  "contentFormat",
  "plausibleSite",
  "gscProperty",
  "notes",
] as const satisfies readonly (keyof ProjectSiteRow)[];

type RegistryKey = (typeof REGISTRY_KEYS)[number];
type RegistryPatch = Partial<Pick<ProjectSiteRow, RegistryKey>>;
type RegistryInput = Pick<ImportSiteInput, RegistryKey>;

type MarketKey = { locationCode: number; languageCode: string };
type DesiredMarket = MarketKey & {
  urlPrefix?: string | null;
  isPrimary?: boolean;
};

const marketKey = (market: MarketKey) =>
  `${market.locationCode}/${market.languageCode}`;

// Blank text clears a field; undefined means "not provided".
const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

function normalizeUrlPrefix(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const stripped = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return stripped ? `/${stripped}` : null;
}

function toRegistryPatch(input: RegistryInput): RegistryPatch {
  return omitBy(
    {
      businessGroup: blankToNull(input.businessGroup),
      brand: blankToNull(input.brand),
      siteRole: input.siteRole,
      opsStatus: input.opsStatus,
      githubRepo: blankToNull(input.githubRepo),
      productionBranch: blankToNull(input.productionBranch),
      hosting: input.hosting,
      coolifyAppUuid: blankToNull(input.coolifyAppUuid),
      coolifyServer: blankToNull(input.coolifyServer),
      autoDeploy: input.autoDeploy,
      templateFamily: input.templateFamily,
      contentFormat: input.contentFormat,
      plausibleSite: blankToNull(input.plausibleSite),
      gscProperty: blankToNull(input.gscProperty),
      notes: blankToNull(input.notes),
    },
    (value) => value === undefined,
  );
}

function toDesiredMarkets(markets: SiteMarketInput[]): DesiredMarket[] {
  const seen = new Set<string>();
  const primaries = markets.filter((market) => market.isPrimary);
  if (primaries.length > 1) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Only one market can be marked primary.",
    );
  }
  return markets.map((market) => {
    assertLanguageForLocation(market.locationCode, market.languageCode);
    const key = marketKey(market);
    if (seen.has(key)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Market ${key} is listed more than once.`,
      );
    }
    seen.add(key);
    return {
      locationCode: market.locationCode,
      languageCode: market.languageCode,
      urlPrefix: normalizeUrlPrefix(market.urlPrefix),
      isPrimary: market.isPrimary,
    };
  });
}

/**
 * Brings a project's stored markets in line with `desired` and keeps
 * projects.location_code/language_code equal to the primary market. `merge`
 * (bulk import) only adds and updates; `replace` (UI editor) also removes
 * markets that are no longer listed. Returns whether anything changed.
 */
async function applyMarkets(
  project: ProjectRow,
  existing: ProjectMarketRow[],
  desired: DesiredMarket[],
  mode: "merge" | "replace",
): Promise<boolean> {
  const existingByKey = new Map(existing.map((row) => [marketKey(row), row]));
  const desiredByKey = new Map(desired.map((row) => [marketKey(row), row]));
  const keptKeys =
    mode === "replace"
      ? [...desiredByKey.keys()]
      : [...new Set([...existingByKey.keys(), ...desiredByKey.keys()])];

  // The primary: the one flagged in the input, else the stored one if it
  // survives, else the project's current default market, else the first listed.
  const flagged = desired.find((market) => market.isPrimary);
  const storedPrimary = existing.find((row) => row.isPrimary);
  const projectKey = marketKey(project);
  let primaryKey: string | null = null;
  if (flagged) primaryKey = marketKey(flagged);
  else if (storedPrimary && keptKeys.includes(marketKey(storedPrimary)))
    primaryKey = marketKey(storedPrimary);
  else if (keptKeys.includes(projectKey)) primaryKey = projectKey;
  else primaryKey = keptKeys[0] ?? null;

  const deletes = existing.filter((row) => !keptKeys.includes(marketKey(row)));
  const updates: { id: string; set: Partial<ProjectMarketRow> }[] = [];
  const inserts: Omit<ProjectMarketRow, "createdAt">[] = [];
  for (const key of keptKeys) {
    const isPrimary = key === primaryKey;
    const want = desiredByKey.get(key);
    const have = existingByKey.get(key);
    if (!have && want) {
      inserts.push({
        id: crypto.randomUUID(),
        projectId: project.id,
        locationCode: want.locationCode,
        languageCode: want.languageCode,
        urlPrefix: want.urlPrefix ?? null,
        isPrimary,
      });
      continue;
    }
    if (!have) continue;
    const set: Partial<ProjectMarketRow> = {};
    if (want?.urlPrefix !== undefined && want.urlPrefix !== have.urlPrefix) {
      set.urlPrefix = want.urlPrefix;
    }
    if (have.isPrimary !== isPrimary) set.isPrimary = isPrimary;
    if (Object.keys(set).length > 0) updates.push({ id: have.id, set });
  }

  // The one-primary index is checked per statement: demote before promoting.
  for (const row of deletes) await SiteRegistryRepository.deleteMarket(row.id);
  for (const update of updates.filter((u) => u.set.isPrimary === false)) {
    await SiteRegistryRepository.updateMarket(update.id, update.set);
  }
  for (const update of updates.filter((u) => u.set.isPrimary !== false)) {
    await SiteRegistryRepository.updateMarket(update.id, update.set);
  }
  for (const row of inserts) await SiteRegistryRepository.insertMarket(row);

  let changed = deletes.length + updates.length + inserts.length > 0;
  const primary = primaryKey
    ? (desiredByKey.get(primaryKey) ?? existingByKey.get(primaryKey))
    : undefined;
  if (primary && marketKey(primary) !== projectKey) {
    await SiteRegistryRepository.setProjectDefaultMarket(project.id, {
      locationCode: primary.locationCode,
      languageCode: primary.languageCode,
    });
    changed = true;
  }
  return changed;
}

/**
 * Writes the registry row, creating it when missing. Returns the changed
 * field names (`created` for a new row), empty when nothing differed.
 */
async function applyRegistry(
  project: ProjectRow,
  existing: ProjectSiteRow | null,
  patch: RegistryPatch,
  meta: { userId: string; imported: boolean },
): Promise<string[]> {
  const stamp = new Date().toISOString();
  const domain =
    normalizeSiteDomain(project.domain ?? "") ?? existing?.domain ?? null;
  if (!existing) {
    await SiteRegistryRepository.insertSite({
      projectId: project.id,
      domain,
      ...patch,
      importedAt: meta.imported ? stamp : null,
      updatedAt: stamp,
      updatedBy: meta.userId,
    });
    return ["registry_created"];
  }
  const changedKeys = REGISTRY_KEYS.filter(
    (key) => key in patch && patch[key] !== existing[key],
  );
  const domainChanged = domain !== existing.domain;
  if (changedKeys.length === 0 && !domainChanged) return [];
  await SiteRegistryRepository.updateSite(project.id, {
    ...pick(patch, changedKeys),
    domain,
    ...(meta.imported ? { importedAt: stamp } : {}),
    updatedAt: stamp,
    updatedBy: meta.userId,
  });
  return domainChanged ? [...changedKeys, "domain"] : changedKeys;
}

async function loadOrganizationState(organizationId: string) {
  const [rows, markets] = await Promise.all([
    SiteRegistryRepository.listProjectsWithSites(organizationId),
    SiteRegistryRepository.listMarkets(organizationId),
  ]);
  return { rows, markets };
}

function effectiveMarkets(project: ProjectRow, stored: ProjectMarketRow[]) {
  if (stored.length === 0) {
    return [
      {
        locationCode: project.locationCode,
        languageCode: project.languageCode,
        urlPrefix: null,
        isPrimary: true,
      },
    ];
  }
  return sortBy(
    stored.map((row) => ({
      locationCode: row.locationCode,
      languageCode: row.languageCode,
      urlPrefix: row.urlPrefix,
      isPrimary: row.isPrimary,
    })),
    [(row) => (row.isPrimary ? 0 : 1), "asc"],
    [(row) => row.urlPrefix ?? "", "asc"],
  );
}

/** Every active project with its registry, markets, and data connections. */
async function listSites(organizationId: string) {
  const [{ rows, markets }, gscConnections] = await Promise.all([
    loadOrganizationState(organizationId),
    SiteRegistryRepository.listGscConnections(organizationId),
  ]);
  const gscByProject = new Map(
    gscConnections.map((row) => [row.projectId, row.siteUrl]),
  );
  const sites = rows.map(({ project, site }) => ({
    projectId: project.id,
    name: project.name,
    domain: site?.domain ?? project.domain,
    registry: site,
    markets: effectiveMarkets(
      project,
      markets.filter((market) => market.projectId === project.id),
    ),
    gscConnected: gscByProject.has(project.id),
    gscSiteUrl: gscByProject.get(project.id) ?? null,
    plausibleConfigured: Boolean(site?.plausibleSite),
  }));
  return sortBy(sites, (row) => (row.domain ?? row.name).toLowerCase());
}

type SiteImportResult = {
  domain: string;
  projectId: string;
  status: "created" | "updated" | "unchanged";
  changes: string[];
};

/**
 * Idempotent bulk import. Matches by normalized domain against the registry
 * domain or the project domain, creates a project when none matches, and
 * never deletes a project, registry row, or market. All input is validated
 * before the first write.
 */
async function upsertSites(args: {
  organizationId: string;
  userId: string;
  sites: ImportSiteInput[];
}): Promise<SiteImportResult[]> {
  const seen = new Set<string>();
  const prepared = args.sites.map((site) => {
    const domain = normalizeSiteDomain(site.domain);
    if (!domain) {
      throw new AppError(
        "VALIDATION_ERROR",
        `"${site.domain}" is not a valid domain.`,
      );
    }
    if (seen.has(domain)) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Domain ${domain} appears more than once in this import.`,
      );
    }
    seen.add(domain);
    return {
      domain,
      name: site.name,
      patch: toRegistryPatch(site),
      markets: site.markets ? toDesiredMarkets(site.markets) : [],
    };
  });

  const { rows, markets } = await loadOrganizationState(args.organizationId);
  const byDomain = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const domain = normalizeSiteDomain(
      row.site?.domain ?? row.project.domain ?? "",
    );
    if (domain && !byDomain.has(domain)) byDomain.set(domain, row);
  }

  const results: SiteImportResult[] = [];
  for (const item of prepared) {
    const match = byDomain.get(item.domain);
    let project = match?.project;
    const changes: string[] = [];
    if (!project) {
      // A new project starts in its primary market so projects.location_code
      // matches from the first write.
      const primary =
        item.markets.find((market) => market.isPrimary) ?? item.markets[0];
      project = await ProjectRepository.createProject(
        args.organizationId,
        item.name ?? item.domain,
        item.domain,
        primary
          ? {
              locationCode: primary.locationCode,
              languageCode: primary.languageCode,
            }
          : undefined,
      );
      changes.push("project");
    } else if (!project.domain) {
      await SiteRegistryRepository.setProjectDomain(project.id, item.domain);
      project = { ...project, domain: item.domain };
      changes.push("projectDomain");
    }
    changes.push(
      ...(await applyRegistry(
        { ...project, domain: item.domain },
        match?.site ?? null,
        item.patch,
        { userId: args.userId, imported: true },
      )),
    );
    const existingMarkets = markets.filter(
      (market) => market.projectId === project.id,
    );
    if (
      item.markets.length > 0 &&
      (await applyMarkets(project, existingMarkets, item.markets, "merge"))
    ) {
      changes.push("markets");
    }
    const isNew = changes.includes("project");
    results.push({
      domain: item.domain,
      projectId: project.id,
      status: isNew ? "created" : changes.length > 0 ? "updated" : "unchanged",
      changes,
    });
  }
  return results;
}

/** UI edit of one row: business fields plus a full replacement market list. */
async function updateSiteRow(args: {
  organizationId: string;
  userId: string;
  input: UpdateSiteRowInput;
}) {
  const project = await ProjectRepository.getProjectForOrganization(
    args.input.projectId,
    args.organizationId,
  );
  if (!project) throw new AppError("NOT_FOUND");
  const desired = toDesiredMarkets(args.input.markets);
  const { rows, markets } = await loadOrganizationState(args.organizationId);
  const site = rows.find((row) => row.project.id === project.id)?.site ?? null;
  await applyRegistry(project, site, toRegistryPatch(args.input), {
    userId: args.userId,
    imported: false,
  });
  await applyMarkets(
    project,
    markets.filter((market) => market.projectId === project.id),
    desired,
    "replace",
  );
  return { success: true };
}

export const SiteRegistryService = {
  listSites,
  upsertSites,
  updateSiteRow,
} as const;
