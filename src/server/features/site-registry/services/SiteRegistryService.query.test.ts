import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { SiteRegistryService } from "./SiteRegistryService";

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

// Real SQLite (libsql in memory) so the unique indexes and upserts run for
// real; only the `db` handle is swapped.
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  return { db: drizzle(createClient({ url: "file::memory:" })) };
});

const org = "org-1";
const user = "user-1";

// The two new tables come straight from the generated migration so the test
// cannot drift from the schema; the tables they reference are minimal.
function siteMigrationStatements() {
  const file = readdirSync("drizzle").find((name) =>
    readFileSync(`drizzle/${name}`, "utf8").includes("project_markets"),
  );
  if (!file) throw new Error("site registry migration not found");
  return readFileSync(`drizzle/${file}`, "utf8").split(
    "--> statement-breakpoint",
  );
}

beforeAll(async () => {
  await db.run(`CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    domain TEXT,
    location_code INTEGER NOT NULL DEFAULT 2840,
    language_code TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT (current_timestamp),
    archived_at TEXT
  )`);
  await db.run(`CREATE TABLE gsc_connections (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    site_url TEXT NOT NULL
  )`);
  for (const statement of siteMigrationStatements()) await db.run(statement);
});

beforeEach(async () => {
  for (const table of [
    "project_markets",
    "project_sites",
    "gsc_connections",
    "projects",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
});

const importSites = (
  sites: Parameters<typeof SiteRegistryService.upsertSites>[0]["sites"],
  organizationId = org,
) => SiteRegistryService.upsertSites({ organizationId, userId: user, sites });

const count = async (table: string) =>
  (await db.all<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

const AR = { locationCode: 2504, languageCode: "ar", urlPrefix: "/ar" };
const FR = { locationCode: 2504, languageCode: "fr", urlPrefix: "/fr" };

describe("site registry import", () => {
  it("is idempotent and matches www/protocol variants to the same project", async () => {
    const batch = [
      {
        domain: "example.com",
        businessGroup: "Group A",
        githubRepo: "acme/example",
        markets: [{ ...AR, isPrimary: true }, FR],
      },
    ];
    const first = await importSites(batch);
    const second = await importSites([
      { ...batch[0], domain: "https://www.Example.com/" },
    ]);

    expect(first.map((r) => r.status)).toEqual(["created"]);
    expect(second.map((r) => r.status)).toEqual(["unchanged"]);
    expect(second[0].projectId).toBe(first[0].projectId);
    expect(await count("projects")).toBe(1);
    expect(await count("project_sites")).toBe(1);
    expect(await count("project_markets")).toBe(2);
  });

  it("adopts an existing project by domain and keeps its location in step with the primary market", async () => {
    await db.run(
      `INSERT INTO projects (id, organization_id, name, domain) VALUES ('p1', '${org}', 'Existing', 'example.com')`,
    );
    await db.run(
      `INSERT INTO projects (id, organization_id, name, domain) VALUES ('p-other', 'org-2', 'Other', 'example.com')`,
    );

    const [result] = await importSites([
      { domain: "www.example.com", markets: [{ ...AR, isPrimary: true }] },
    ]);

    expect(result).toMatchObject({ projectId: "p1", status: "updated" });
    expect(await count("projects")).toBe(2);
    const [project] = await db.all<{
      location_code: number;
      language_code: string;
    }>(`SELECT location_code, language_code FROM projects WHERE id = 'p1'`);
    expect(project).toEqual({ location_code: 2504, language_code: "ar" });
  });

  it("adds markets without removing existing ones and moves the primary", async () => {
    await importSites([
      { domain: "example.com", markets: [{ ...AR, isPrimary: true }] },
    ]);
    await importSites([
      { domain: "example.com", markets: [{ ...FR, isPrimary: true }] },
    ]);

    const [site] = await SiteRegistryService.listSites(org);
    expect(site.markets).toEqual([
      { ...FR, isPrimary: true },
      { ...AR, isPrimary: false },
    ]);
  });
});

describe("site overview", () => {
  it("lists unregistered projects with the project market as primary and reports GSC/Plausible", async () => {
    await db.run(
      `INSERT INTO projects (id, organization_id, name) VALUES ('p-research', '${org}', 'Research')`,
    );
    await importSites([
      { domain: "example.com", plausibleSite: "example.com" },
    ]);
    const [registered] = await SiteRegistryService.listSites(org);
    await db.run(
      `INSERT INTO gsc_connections (id, project_id, organization_id, site_url) VALUES ('g1', '${registered.projectId}', '${org}', 'sc-domain:example.com')`,
    );

    const sites = await SiteRegistryService.listSites(org);
    const research = sites.find((site) => site.projectId === "p-research");
    const example = sites.find(
      (site) => site.projectId === registered.projectId,
    );

    expect(research).toMatchObject({
      registry: null,
      gscConnected: false,
      plausibleConfigured: false,
      markets: [{ locationCode: 2840, languageCode: "en", isPrimary: true }],
    });
    expect(example).toMatchObject({
      gscConnected: true,
      plausibleConfigured: true,
    });
  });
});
