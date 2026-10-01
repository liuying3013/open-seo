import { beforeEach, describe, expect, it, vi } from "vitest";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { SiteRegistryRepository } from "@/server/features/site-registry/repositories/SiteRegistryRepository";
import { SiteRegistryService } from "@/server/features/site-registry/services/SiteRegistryService";
import { GscAutoMatchService } from "./GscAutoMatchService";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/runtime-env", () => ({
  isHostedServerAuthMode: async () => false,
}));
vi.mock("@/server/features/google/oauth-config", () => ({
  hasSelfHostedGoogleOAuthConfig: async () => true,
}));
vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { listSitesForUserWithGrantStatus: vi.fn() },
}));
vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: { upsert: vi.fn() },
}));
vi.mock(
  "@/server/features/site-registry/repositories/SiteRegistryRepository",
  () => ({
    SiteRegistryRepository: {
      listProjectsWithSites: vi.fn(),
      listGscConnections: vi.fn(),
    },
  }),
);
vi.mock("@/server/features/site-registry/services/SiteRegistryService", () => ({
  SiteRegistryService: { setGscProperty: vi.fn() },
}));

const input = { organizationId: "org1", userId: "user1" };

const project = (id: string, domain: string | null) => ({
  project: {
    id,
    domain,
    organizationId: "org1",
    name: id,
    locationCode: 2840,
    languageCode: "en",
    createdAt: "2026-01-01",
    archivedAt: null,
  },
  site: null,
});

beforeEach(() => {
  vi.mocked(SiteRegistryRepository.listProjectsWithSites).mockResolvedValue([
    project("p-connected", "connected.com"),
    project("p-domain", "example.com"),
    project("p-second-account", "other.org"),
    project("p-none", "nomatch.net"),
    project("p-blank", null),
  ]);
  vi.mocked(SiteRegistryRepository.listGscConnections).mockResolvedValue([
    { projectId: "p-connected", siteUrl: "https://connected.com/" },
  ]);
  vi.mocked(GscService.listSitesForUserWithGrantStatus).mockResolvedValue({
    accounts: [
      {
        accountId: "acc1",
        email: "a@example.test",
        requiresReconnect: false,
        propertiesUnavailable: false,
        sites: [
          { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
          { siteUrl: "https://connected.com/", permissionLevel: "siteOwner" },
        ],
      },
      {
        accountId: "acc2",
        email: "b@example.test",
        requiresReconnect: false,
        propertiesUnavailable: false,
        sites: [
          {
            siteUrl: "https://www.other.org/",
            permissionLevel: "siteFullUser",
          },
        ],
      },
    ],
  });
});

describe("GscAutoMatchService.autoMatch", () => {
  it("plans matches across accounts without writing on a dry run", async () => {
    const result = await GscAutoMatchService.autoMatch({
      ...input,
      dryRun: true,
    });

    expect(
      result.matched.map((m) => [m.projectId, m.siteUrl, m.accountId]),
    ).toEqual([
      ["p-domain", "sc-domain:example.com", "acc1"],
      ["p-second-account", "https://www.other.org/", "acc2"],
    ]);
    expect(result.unmatched).toEqual([
      {
        projectId: "p-none",
        domain: "nomatch.net",
        reason: "no_matching_property",
      },
      { projectId: "p-blank", domain: null, reason: "no_domain" },
    ]);
    expect(result.skipped.map((s) => s.projectId)).toEqual(["p-connected"]);
    expect(GscConnectionRepository.upsert).not.toHaveBeenCalled();
    expect(SiteRegistryService.setGscProperty).not.toHaveBeenCalled();
  });

  it("connects only unconnected projects and records the property in the registry", async () => {
    const result = await GscAutoMatchService.autoMatch({
      ...input,
      dryRun: false,
    });

    expect(result.matched.every((m) => m.applied)).toBe(true);
    expect(
      vi.mocked(GscConnectionRepository.upsert).mock.calls.map(([c]) => c),
    ).toEqual([
      expect.objectContaining({
        projectId: "p-domain",
        siteUrl: "sc-domain:example.com",
        gscAccountId: "acc1",
        connectedByUserId: "user1",
      }),
      expect.objectContaining({
        projectId: "p-second-account",
        gscAccountId: "acc2",
      }),
    ]);
    expect(SiteRegistryService.setGscProperty).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-domain",
        gscProperty: "sc-domain:example.com",
      }),
    );
  });

  it("does not blame the domain when no Google account is readable", async () => {
    vi.mocked(GscService.listSitesForUserWithGrantStatus).mockResolvedValue({
      accounts: [],
    });

    const result = await GscAutoMatchService.autoMatch({
      ...input,
      dryRun: true,
    });

    expect(result.hasGoogleAccount).toBe(false);
    expect(result.unmatched.find((u) => u.projectId === "p-none")?.reason).toBe(
      "no_accessible_accounts",
    );
  });
});
