import { readdirSync, readFileSync } from "node:fs";
import { sort } from "remeda";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { PagePlanError } from "./pagePlanErrors";
import { PagePlansService } from "./services/PagePlansService";
import { SitePagesService } from "./services/SitePagesService";

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

// Real SQLite (libsql in memory) with the real migrations, so unique indexes,
// foreign keys and upserts run for real. runBatch is the production helper's
// contract (statements in order) minus the D1/Postgres transaction plumbing.
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  return { db: drizzle(createClient({ url: "file::memory:" })) };
});
vi.mock("@/db/runBatch", async () => {
  const { db: testDb } = await import("@/db");
  return {
    runBatch: async (build: (tx: typeof testDb) => Promise<unknown>[]) => {
      for (const statement of build(testDb)) await statement;
    },
    executeInBatches: async <T>(
      items: T[],
      build: (tx: typeof testDb, item: T) => Promise<unknown>,
    ) => {
      for (const item of items) await build(testDb, item);
    },
  };
});

beforeAll(async () => {
  const files = sort(
    readdirSync("drizzle").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  );
  for (const file of files) {
    for (const statement of readFileSync(`drizzle/${file}`, "utf8").split(
      "--> statement-breakpoint",
    )) {
      if (statement.trim()) await db.run(statement);
    }
  }
});

const P1 = "project-1";
const P2 = "project-2";

beforeEach(async () => {
  for (const table of [
    "page_plan_items",
    "page_plans",
    "content_assets",
    "clusters",
    "site_pages",
    "project_key_pages",
    "projects",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  await db.run(
    `INSERT OR IGNORE INTO organization (id, name, slug, created_at) VALUES ('org-1', 'Org', 'org', 0)`,
  );
  await db.run(
    `INSERT INTO projects (id, organization_id, name, domain) VALUES
      ('${P1}', 'org-1', 'One', 'example.com'),
      ('${P2}', 'org-1', 'Two', 'other.com')`,
  );
  await db.run(
    `INSERT INTO clusters (id, project_id, name) VALUES
      ('c1', '${P1}', 'Cluster 1'),
      ('c2', '${P1}', 'Cluster 2'),
      ('c-other', '${P2}', 'Other cluster')`,
  );
});

const count = async (table: string) =>
  (await db.all<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0].n;

const pageIdOf = async (projectId: string, url: string) =>
  (
    await db.all<{ id: string }>(
      `SELECT id FROM site_pages WHERE project_id = '${projectId}' AND url = '${url}'`,
    )
  )[0].id;

describe("site page import", () => {
  it("normalizes URLs, is idempotent, rejects off-site URLs and takes roles from key pages", async () => {
    await db.run(
      `INSERT INTO project_key_pages (id, project_id, url, role, updated_by)
       VALUES ('k1', '${P1}', 'https://example.com/guide/', 'hub', 'user')`,
    );
    const pages = [
      { url: "HTTP://Example.com/guide/#intro", title: "Guide" },
      { url: "/ar/faq", language: "AR" },
      { url: "https://elsewhere.com/x" },
    ];

    const first = await SitePagesService.importPages({
      projectId: P1,
      pages,
    });
    const second = await SitePagesService.importPages({
      projectId: P1,
      pages,
    });

    expect(first).toMatchObject({ created: 2, unchanged: 0 });
    expect(first.rejected).toHaveLength(1);
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await count("site_pages")).toBe(2);
    const { rows } = await SitePagesService.list(P1, {});
    expect(rows.map((row) => [row.url, row.language, row.pageRole])).toEqual([
      ["https://example.com/ar/faq", "ar", null],
      ["https://example.com/guide", null, "hub"],
    ]);
  });

  it("marks pages missing from a full import out of the sitemap without deleting them", async () => {
    await SitePagesService.importPages({
      projectId: P1,
      pages: [{ url: "/a" }, { url: "/b" }],
    });

    const result = await SitePagesService.importPages({
      projectId: P1,
      pages: [{ url: "/a" }],
      markMissingOutOfSitemap: true,
    });

    expect(result.markedOutOfSitemap).toBe(1);
    const { rows } = await SitePagesService.list(P1, { inSitemap: false });
    expect(rows.map((row) => row.path)).toEqual(["/b"]);
  });
});

describe("cluster targets", () => {
  it("rejects a target page from another project and writes nothing", async () => {
    await SitePagesService.importPages({
      projectId: P2,
      pages: [{ url: "https://other.com/page" }],
    });
    const foreignPageId = await pageIdOf(P2, "https://other.com/page");

    await expect(
      SitePagesService.setClusterTargets(P1, [
        { clusterId: "c1", plannedAction: "update" },
        { clusterId: "c2", targetPageId: foreignPageId },
      ]),
    ).rejects.toMatchObject({ code: "SITE_PAGE_NOT_FOUND" });

    const [cluster] = await db.all<{ planned_action: string | null }>(
      `SELECT planned_action FROM clusters WHERE id = 'c1'`,
    );
    expect(cluster.planned_action).toBeNull();
  });

  it("sets and counts targets, leaving omitted fields alone", async () => {
    await SitePagesService.importPages({
      projectId: P1,
      pages: [{ url: "/guide" }],
    });
    const pageId = await pageIdOf(P1, "https://example.com/guide");

    await SitePagesService.setClusterTargets(P1, [
      {
        clusterId: "c1",
        targetPageId: pageId,
        plannedAction: "update",
        actionReason: "thin page",
      },
    ]);
    await SitePagesService.setClusterTargets(P1, [
      { clusterId: "c1", plannedAction: "add_section" },
    ]);

    const [cluster] = await db.all<{
      target_page_id: string;
      planned_action: string;
      action_reason: string;
    }>(
      `SELECT target_page_id, planned_action, action_reason FROM clusters WHERE id = 'c1'`,
    );
    expect(cluster).toEqual({
      target_page_id: pageId,
      planned_action: "add_section",
      action_reason: "thin page",
    });
    const { rows } = await SitePagesService.list(P1, {});
    expect(rows[0].clusterCount).toBe(1);
  });
});

describe("page plans", () => {
  const items = [
    {
      action: "new" as const,
      targetUrl: "/new-guide",
      clusterId: "c1",
      score: 80,
    },
    { action: "watch" as const, targetUrl: "/watched", clusterId: "c2" },
  ];

  it("keeps one draft per month and replaces its items", async () => {
    await PagePlansService.createDraft({
      projectId: P1,
      period: "2026-11",
      items,
    });
    const again = await PagePlansService.createDraft({
      projectId: P1,
      period: "2026-11",
      items: [items[0]],
    });

    expect(await count("page_plans")).toBe(1);
    expect(again.items).toHaveLength(1);
    expect(again.items[0].targetUrl).toBe("https://example.com/new-guide");
  });

  it("rejects a cluster from another project", async () => {
    await expect(
      PagePlansService.createDraft({
        projectId: P1,
        period: "2026-11",
        items: [{ action: "new", targetUrl: "/x", clusterId: "c-other" }],
      }),
    ).rejects.toMatchObject({ code: "CLUSTER_NOT_FOUND" });
  });

  it("creates work orders only on approval by a user, then freezes the plan", async () => {
    const { plan } = await PagePlansService.createDraft({
      projectId: P1,
      period: "2026-11",
      items: [
        ...items,
        {
          action: "update",
          targetUrl: "/off",
          clusterId: "c2",
          included: false,
        },
      ],
    });

    await expect(
      PagePlansService.approve({ projectId: P1, planId: plan.id, userId: "" }),
    ).rejects.toBeInstanceOf(PagePlanError);
    expect(await count("content_assets")).toBe(0);

    const result = await PagePlansService.approve({
      projectId: P1,
      planId: plan.id,
      userId: "user-1",
    });

    // Only the included new/update/add_section/merge item gets a work order.
    expect(result.assets).toHaveLength(1);
    const [asset] = await db.all<{
      project_id: string;
      cluster_id: string;
      target_url: string;
      status: string;
    }>(`SELECT project_id, cluster_id, target_url, status FROM content_assets`);
    expect(asset).toEqual({
      project_id: P1,
      cluster_id: "c1",
      target_url: "https://example.com/new-guide",
      status: "planned",
    });
    const approved = await PagePlansService.getPlan(P1, "2026-11");
    expect(approved?.plan).toMatchObject({
      status: "approved",
      approvedByUserId: "user-1",
    });
    expect(approved?.items.find((i) => i.assetId)?.assetId).toBe(
      result.assets[0].assetId,
    );

    await expect(
      PagePlansService.createDraft({
        projectId: P1,
        period: "2026-11",
        items,
      }),
    ).rejects.toMatchObject({ code: "PLAN_NOT_EDITABLE" });
    await expect(
      PagePlansService.approve({
        projectId: P1,
        planId: plan.id,
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "PLAN_NOT_EDITABLE" });
  });
});
