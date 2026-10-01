import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as OpportunitiesModule from "./OpportunitiesRepository";
import type * as BudgetsModule from "./OpportunityBudgetsRepository";
import type * as RunsModule from "./OpportunityRunsRepository";

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

let client: Client;
let OpportunitiesRepository: typeof OpportunitiesModule.OpportunitiesRepository;
let OpportunityBudgetsRepository: typeof BudgetsModule.OpportunityBudgetsRepository;
let OpportunityRunsRepository: typeof RunsModule.OpportunityRunsRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  vi.doMock("@/db", () => ({ db: testDb }));
  await client.executeMultiple(`
    CREATE TABLE opportunities (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      name_zh TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'discovered',
      status_changed_at TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      seed_notes TEXT,
      description TEXT,
      target_countries TEXT NOT NULL,
      language_code TEXT NOT NULL DEFAULT 'en',
      ip_risk TEXT NOT NULL DEFAULT 'unknown',
      estimated_unit_price_usd REAL,
      latest_score REAL,
      latest_confidence REAL,
      latest_score_version TEXT,
      graduated_project_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX opportunities_organization_name_idx
      ON opportunities (organization_id, normalized_name);
    CREATE TABLE opportunity_budgets (
      organization_id TEXT NOT NULL,
      date TEXT NOT NULL,
      llm_calls INTEGER NOT NULL DEFAULT 0,
      keyword_lookups INTEGER NOT NULL DEFAULT 0,
      serp_fetches INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (organization_id, date)
    );
    CREATE TABLE opportunity_runs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      stats TEXT,
      error TEXT
    );
    CREATE UNIQUE INDEX opportunity_runs_one_active_per_org_kind_idx
      ON opportunity_runs (organization_id, kind) WHERE status = 'running';
  `);
  ({ OpportunitiesRepository } = await import("./OpportunitiesRepository"));
  ({ OpportunityBudgetsRepository } =
    await import("./OpportunityBudgetsRepository"));
  ({ OpportunityRunsRepository } = await import("./OpportunityRunsRepository"));
});

afterAll(() => client.close());

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM opportunity_runs;
    DELETE FROM opportunity_budgets;
    DELETE FROM opportunities;
  `);
});

async function insertOpportunity(organizationId: string, name: string) {
  const id = await OpportunitiesRepository.insert({
    organizationId,
    name,
    normalizedName: name.toLowerCase(),
    type: "other",
    targetCountries: ["US"],
    languageCode: "en",
    ipRisk: "green",
  });
  if (!id) throw new Error("test opportunity unexpectedly conflicted");
  return id;
}

describe("opportunity organization isolation", () => {
  it("allows the same normalized seed in two organizations and never cross-reads it", async () => {
    const org1Id = await insertOpportunity("org-1", "Shared seed");
    const org2Id = await insertOpportunity("org-2", "Shared seed");
    await expect(
      OpportunitiesRepository.insert({
        organizationId: "org-1",
        name: "Shared seed",
        normalizedName: "shared seed",
        type: "other",
        targetCountries: ["US"],
        languageCode: "en",
        ipRisk: "green",
      }),
    ).resolves.toBeNull();

    await expect(
      OpportunitiesRepository.getById("org-1", org2Id),
    ).resolves.toBeNull();
    await expect(
      OpportunitiesRepository.getByNormalizedName("org-1", "shared seed"),
    ).resolves.toMatchObject({ id: org1Id, organizationId: "org-1" });
    await expect(
      OpportunitiesRepository.listByStatuses("org-2", ["discovered"]),
    ).resolves.toEqual([
      expect.objectContaining({ id: org2Id, organizationId: "org-2" }),
    ]);
  });

  it("uses compare-and-set for status transitions", async () => {
    const id = await insertOpportunity("org-1", "Race safe");
    expect(
      await OpportunitiesRepository.updateStatus(
        "org-1",
        id,
        "discovered",
        "keyword_scanned",
      ),
    ).toBe(true);
    expect(
      await OpportunitiesRepository.updateStatus(
        "org-1",
        id,
        "discovered",
        "rejected",
      ),
    ).toBe(false);
  });

  it("claims graduation for one project and blocks competing review writes", async () => {
    const id = await insertOpportunity("org-1", "Graduate safely");
    await OpportunitiesRepository.updateStatus(
      "org-1",
      id,
      "discovered",
      "shortlisted",
    );

    await expect(
      OpportunitiesRepository.claimGraduation("org-1", id, "project-1"),
    ).resolves.toBe("claimed");
    await expect(
      OpportunitiesRepository.claimGraduation("org-1", id, "project-2"),
    ).resolves.toBe("conflict");
    await expect(
      OpportunitiesRepository.updateStatus(
        "org-1",
        id,
        "shortlisted",
        "rejected",
      ),
    ).resolves.toBe(false);
    await expect(
      OpportunitiesRepository.updateStatus(
        "org-1",
        id,
        "shortlisted",
        "graduated",
        "project-1",
      ),
    ).resolves.toBe(true);
  });
});

describe("opportunity concurrency guards", () => {
  it("atomically enforces the daily provider cap", async () => {
    const attempts = await Promise.all([
      OpportunityBudgetsRepository.tryConsume({
        organizationId: "org-1",
        date: "2026-09-01",
        kind: "serpFetches",
        amount: 1,
        limit: 1,
      }),
      OpportunityBudgetsRepository.tryConsume({
        organizationId: "org-1",
        date: "2026-09-01",
        kind: "serpFetches",
        amount: 1,
        limit: 1,
      }),
    ]);
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt)).toHaveLength(1);
  });

  it("allows only one active scan per organization, but not globally", async () => {
    const first = await OpportunityRunsRepository.start("org-1", "scan");
    const duplicate = await OpportunityRunsRepository.start("org-1", "scan");
    const otherOrg = await OpportunityRunsRepository.start("org-2", "scan");

    expect(first).toBeTruthy();
    expect(duplicate).toBeNull();
    expect(otherOrg).toBeTruthy();
  });
});
