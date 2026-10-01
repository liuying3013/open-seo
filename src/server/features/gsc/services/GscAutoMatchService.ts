import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  pickPropertyForDomain,
  type GscMatchFailure,
  type GscPropertyCandidate,
} from "@/server/features/gsc/gscDomainMatch";
import { GscService } from "@/server/features/gsc/services/GscService";
import { hasSelfHostedGoogleOAuthConfig } from "@/server/features/google/oauth-config";
import { SiteRegistryRepository } from "@/server/features/site-registry/repositories/SiteRegistryRepository";
import { SiteRegistryService } from "@/server/features/site-registry/services/SiteRegistryService";
import { isHostedServerAuthMode } from "@/server/lib/runtime-env";
import { normalizeSiteDomain } from "@/shared/siteRegistry";

type UnmatchedReason = GscMatchFailure | "no_domain" | "no_accessible_accounts";

type MatchedProject = {
  projectId: string;
  domain: string;
  siteUrl: string;
  accountId: string;
  accountEmail: string | null;
  permissionLevel: string;
  /** Only meaningful for a real run: whether the connection was written. */
  applied: boolean;
  error?: string;
};

/**
 * Connects every project that has no Search Console connection yet to the
 * property that covers its domain, across all Google accounts the user has
 * linked. Projects that already have a connection are never touched.
 * With `dryRun` it only returns the plan.
 */
async function autoMatch(input: {
  organizationId: string;
  userId: string;
  dryRun: boolean;
}) {
  const [projects, connections, hosted, configured, grants] = await Promise.all(
    [
      SiteRegistryRepository.listProjectsWithSites(input.organizationId),
      SiteRegistryRepository.listGscConnections(input.organizationId),
      isHostedServerAuthMode(),
      hasSelfHostedGoogleOAuthConfig(),
      GscService.listSitesForUserWithGrantStatus(input.userId),
    ],
  );
  const connectedProjectIds = new Set(connections.map((row) => row.projectId));

  const candidates: GscPropertyCandidate[] = grants.accounts.flatMap(
    (account) =>
      account.sites.map((site) => ({
        accountId: account.accountId,
        accountEmail: account.email,
        siteUrl: site.siteUrl,
        permissionLevel: site.permissionLevel,
      })),
  );
  const accounts = grants.accounts.map((account) => ({
    accountId: account.accountId,
    email: account.email,
    propertyCount: account.sites.length,
    requiresReconnect: account.requiresReconnect,
    propertiesUnavailable: account.propertiesUnavailable,
  }));
  const anyAccountReadable = accounts.some(
    (account) => !account.requiresReconnect && !account.propertiesUnavailable,
  );

  const matched: MatchedProject[] = [];
  const unmatched: {
    projectId: string;
    domain: string | null;
    reason: UnmatchedReason;
  }[] = [];
  const skipped: { projectId: string; domain: string | null }[] = [];

  for (const { project, site } of projects) {
    const rawDomain = site?.domain ?? project.domain;
    const domain = rawDomain ? normalizeSiteDomain(rawDomain) : null;
    if (connectedProjectIds.has(project.id)) {
      skipped.push({ projectId: project.id, domain });
      continue;
    }
    if (!domain) {
      unmatched.push({
        projectId: project.id,
        domain: null,
        reason: "no_domain",
      });
      continue;
    }
    const picked = pickPropertyForDomain(domain, candidates);
    if ("match" in picked) {
      matched.push({
        projectId: project.id,
        domain,
        siteUrl: picked.match.siteUrl,
        accountId: picked.match.accountId,
        accountEmail: picked.match.accountEmail,
        permissionLevel: picked.match.permissionLevel,
        applied: false,
      });
    } else {
      unmatched.push({
        projectId: project.id,
        domain,
        // With no readable account the missing match says nothing about the
        // domain; point at the accounts instead.
        reason: anyAccountReadable ? picked.failure : "no_accessible_accounts",
      });
    }
  }

  if (!input.dryRun) {
    for (const item of matched) {
      try {
        await GscConnectionRepository.upsert({
          projectId: item.projectId,
          organizationId: input.organizationId,
          siteUrl: item.siteUrl,
          connectedByUserId: input.userId,
          gscAccountId: item.accountId,
          connectedAccountEmail: item.accountEmail,
        });
        await SiteRegistryService.setGscProperty({
          organizationId: input.organizationId,
          userId: input.userId,
          projectId: item.projectId,
          gscProperty: item.siteUrl,
        });
        item.applied = true;
      } catch (error) {
        item.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    dryRun: input.dryRun,
    // Without a linked Google account there is nothing to match against.
    hasGoogleAccount: accounts.length > 0,
    googleOAuthConfigured: hosted || configured,
    accounts,
    matched,
    unmatched,
    skipped,
  };
}

export const GscAutoMatchService = { autoMatch };
