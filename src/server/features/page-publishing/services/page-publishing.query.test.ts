import { readdirSync, readFileSync } from "node:fs";
import { sort } from "remeda";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { getBytesFromR2, putBytesToR2 } from "@/server/lib/r2";
import type { ContentDraft } from "../rules/contentChecks";
import { ApprovalService, type ReviewActor } from "./ApprovalService";
import { ContentVersionService } from "./ContentVersionService";
import { PageReviewService } from "./PageReviewService";
import { PublishService } from "./PublishService";
import { SiteChangeAlertService } from "./SiteChangeAlertService";

// Real SQLite (libsql in memory) with the project's generated migrations, so
// the batches, unique indexes and queue joins run for real.

vi.mock("cloudflare:workers", () => ({ env: { DATABASE_PROVIDER: "d1" } }));
vi.mock("@/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  return { db: drizzle(createClient({ url: "file::memory:" })) };
});
vi.mock("@/db/d1/client", async () => ({ d1Db: (await import("@/db")).db }));
vi.mock("@/db/pg/client", () => ({ pgDb: null }));
vi.mock("@/server/lib/r2", () => ({
  putBytesToR2: vi.fn(),
  getBytesFromR2: vi.fn(),
}));

const project = "project-1";
const user: ReviewActor = { userId: "user-1", source: "session" };

beforeAll(async () => {
  const files = sort(
    readdirSync("drizzle").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  );
  for (const file of files) {
    const sql = readFileSync(`drizzle/${file}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.run(statement);
    }
  }
});

beforeEach(async () => {
  for (const table of [
    "site_change_alerts",
    "publish_attempts",
    "content_asset_comments",
    "content_asset_approvals",
    "content_asset_version_files",
    "content_asset_versions",
    "content_assets",
    "clusters",
    "site_pages",
    "project_sites",
    "projects",
  ]) {
    await db.run(`DELETE FROM ${table}`);
  }
  await db.run(
    `INSERT OR IGNORE INTO organization (id, name, slug, created_at) VALUES ('org-1', 'Org', 'org', 0)`,
  );
  await db.run(
    `INSERT INTO projects (id, organization_id, name) VALUES ('${project}', 'org-1', 'Site')`,
  );
  await db.run(
    `INSERT INTO project_sites (project_id, domain, github_repo, production_branch, auto_deploy) VALUES ('${project}', 'example.com', 'acme/site', 'main', 1)`,
  );
  await db.run(
    `INSERT INTO clusters (id, project_id, name) VALUES ('cluster-1', '${project}', 'Cluster')`,
  );
  await db.run(
    `INSERT INTO content_assets (id, project_id, cluster_id, platform, status, target_url, language) VALUES ('asset-1', '${project}', 'cluster-1', 'money_site', 'planned', 'https://example.com/guide', 'en')`,
  );
});

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    title: "A practical guide to choosing the right widget",
    metaDescription:
      "How to pick a widget: the sizes, materials and trade-offs that matter, with a short checklist you can use today.",
    slug: "guide",
    body: "## Start here\n\nPick by size.\n\n## Materials\n\nSteel lasts.",
    internalLinkTargets: [],
    imageBriefs: [],
    cta: "",
    structuredDataType: null,
    claimsUsed: [],
    ...overrides,
  };
}

let patchCounter = 0;
function submit(overrides: Partial<ContentDraft> = {}) {
  patchCounter += 1;
  return ContentVersionService.submit({
    projectId: project,
    assetId: "asset-1",
    draft: draft(overrides),
    implementation: {
      taskBranch: "task/guide",
      baseCommit: "base0000",
      headCommit: `head${patchCounter}000`,
      patchId: `patch${patchCounter}000`,
      diffText: "diff --git a/x b/x",
      files: [{ path: "content/guide.mdx", change: "added" }],
    },
  });
}

async function approved(publishAt?: string) {
  const { versionId } = await submit();
  const { approvalId } = await ApprovalService.approve({
    projectId: project,
    assetId: "asset-1",
    versionId,
    actor: user,
    publishAt,
  });
  return { versionId, approvalId };
}

const assetStatus = async () =>
  (await PageReviewService.getDetail(project, "asset-1")).asset.status;

const expectCode = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

describe("versions and approvals", () => {
  it("numbers versions per work order and voids the approval of an older one", async () => {
    const first = await approved();
    expect(first).toBeTruthy();
    expect(await assetStatus()).toBe("ready_to_publish");

    const second = await submit();
    expect(second.version).toBe(2);
    expect(await assetStatus()).toBe("qa_review");

    const detail = await PageReviewService.getDetail(project, "asset-1");
    expect(detail.approvals.map((a) => a.isActive)).toEqual([false]);
    expect((await PublishService.getQueue(project)).publish).toEqual([]);
    await expectCode(
      ApprovalService.approve({
        projectId: project,
        assetId: "asset-1",
        versionId: first.versionId,
        actor: user,
      }),
      "STALE_VERSION",
    );
  });

  it("refuses approval with a blocking check or from an API-key caller", async () => {
    const blocked = await submit({ body: "" });
    expect(blocked.checks.blocking).toBe(1);
    await expectCode(
      ApprovalService.approve({
        projectId: project,
        assetId: "asset-1",
        versionId: blocked.versionId,
        actor: user,
      }),
      "APPROVAL_BLOCKED",
    );

    const good = await submit();
    await expectCode(
      ApprovalService.approve({
        projectId: project,
        assetId: "asset-1",
        versionId: good.versionId,
        actor: { userId: "user-1", source: "api_key" },
      }),
      "SESSION_REQUIRED",
    );
    expect(await assetStatus()).toBe("qa_review");
  });

  it("checks internal links against the site page inventory in any spelling", async () => {
    await db.run(
      `INSERT INTO site_pages (id, project_id, url, path) VALUES ('page-1', '${project}', 'https://example.com/widgets', '/widgets')`,
    );
    const { checks } = await submit({
      body: "## Start here\n\nSee [widgets](/widgets/) and [old](/retired).",
    });
    const links = checks.checks.find((check) => check.id === "internal_links");
    expect(links?.level).toBe("warning");
    expect(links?.message).toContain("/retired");
    expect(links?.message).not.toContain("/widgets");
  });

  it("returns a rejected work order to drafted with the comment on record", async () => {
    const { versionId } = await submit();
    await ApprovalService.reject({
      projectId: project,
      assetId: "asset-1",
      versionId,
      actor: user,
      comment: "Tighten the intro.",
    });
    const detail = await PageReviewService.getDetail(project, "asset-1");
    expect(detail.asset.status).toBe("drafted");
    expect(detail.approvals[0]).toMatchObject({
      decision: "rejected",
      comment: "Tighten the intro.",
    });
  });
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const liveOk = {
  liveStatusCode: 200,
  textMatch: 97,
  liveCheck: { noindex: false },
};

async function startAttempt(approvalId: string) {
  const { attemptId } = await PublishService.recordAttempt({
    projectId: project,
    assetId: "asset-1",
    approvalId,
    status: "publishing",
  });
  return attemptId;
}

describe("publish attempts", () => {
  it("writes published only when the live check passes", async () => {
    const { approvalId } = await approved();
    const attemptId = await startAttempt(approvalId);

    const rejected = await PublishService.recordAttempt({
      projectId: project,
      attemptId,
      status: "published",
      ...liveOk,
      liveCheck: { noindex: true },
    });
    expect(rejected.status).toBe("unverified");
    expect(await assetStatus()).toBe("ready_to_publish");

    const second = await startAttempt(approvalId);
    const result = await PublishService.recordAttempt({
      projectId: project,
      attemptId: second,
      status: "published",
      mergeCommit: "merge000",
      ...liveOk,
    });
    expect(result.status).toBe("published");
    const detail = await PageReviewService.getDetail(project, "asset-1");
    expect(detail.asset).toMatchObject({
      status: "published",
      publishedUrl: "https://example.com/guide",
    });
    expect((await PublishService.getQueue(project)).publish).toEqual([]);
  });

  it("voids the approval and returns to qa_review on a fingerprint mismatch", async () => {
    const { approvalId } = await approved();
    const attemptId = await startAttempt(approvalId);
    await PublishService.recordAttempt({
      projectId: project,
      attemptId,
      status: "failed",
      errorStage: "fingerprint",
      errorMessage: "patch id differs",
    });
    const detail = await PageReviewService.getDetail(project, "asset-1");
    expect(detail.asset.status).toBe("qa_review");
    expect(detail.approvals.map((a) => a.isActive)).toEqual([false]);
    expect(detail.comments.map((c) => c.userId)).toEqual(["system"]);
    expect(detail.comments[0].body).toContain("patch id differs");
  });

  it("stores screenshots in R2 under the attempt and rejects oversized ones", async () => {
    const { approvalId } = await approved();
    const attemptId = await startAttempt(approvalId);
    await PublishService.recordAttempt({
      projectId: project,
      attemptId,
      status: "verifying",
      screenshotDesktopPngBase64: png.toString("base64"),
    });
    expect(putBytesToR2).toHaveBeenCalledWith(
      `publish/${attemptId}/desktop.png`,
      expect.any(Uint8Array),
      "image/png",
    );

    vi.mocked(getBytesFromR2).mockResolvedValue(new Uint8Array(png));
    const read = await PublishService.readScreenshot(
      project,
      attemptId,
      "desktop",
    );
    expect(read.base64).toBe(png.toString("base64"));

    const big = Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]);
    await expectCode(
      PublishService.recordAttempt({
        projectId: project,
        attemptId,
        status: "verifying",
        screenshotMobilePngBase64: big.toString("base64"),
      }),
      "INVALID_PUBLISH_INPUT",
    );
  });
});

describe("publish queue", () => {
  it("lists only due, still-valid approvals", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await approved(future);
    expect((await PublishService.getQueue(project)).publish).toEqual([]);

    await ApprovalService.revoke({
      projectId: project,
      assetId: "asset-1",
      actor: user,
    });
    await approved(new Date(Date.now() - 1000).toISOString());
    const queue = await PublishService.getQueue(project);
    expect(queue.publish).toHaveLength(1);
    expect(queue.publish[0]).toMatchObject({
      assetId: "asset-1",
      version: 2,
      approvedPatchId: (await PageReviewService.getDetail(project, "asset-1"))
        .version?.patchId,
      taskBranch: "task/guide",
    });
    expect(queue.site).toMatchObject({
      githubRepo: "acme/site",
      productionBranch: "main",
      autoDeploy: true,
    });
  });

  it("queues rollback requests only for published work orders", async () => {
    await expectCode(
      ApprovalService.requestRollback({
        projectId: project,
        assetId: "asset-1",
        actor: user,
      }),
      "INVALID_STATUS_TRANSITION",
    );

    const { approvalId } = await approved();
    const attemptId = await startAttempt(approvalId);
    await PublishService.recordAttempt({
      projectId: project,
      attemptId,
      status: "published",
      mergeCommit: "merge000",
      ...liveOk,
    });
    const { attemptId: rollbackId } = await ApprovalService.requestRollback({
      projectId: project,
      assetId: "asset-1",
      actor: user,
    });
    const { rollbacks } = await PublishService.getQueue(project);
    expect(rollbacks).toMatchObject([
      { attemptId: rollbackId, mergeCommit: "merge000" },
    ]);

    await PublishService.recordAttempt({
      projectId: project,
      attemptId: rollbackId,
      status: "rolled_back",
    });
    expect(await assetStatus()).toBe("drafted");
    expect((await PublishService.getQueue(project)).rollbacks).toEqual([]);
  });
});

describe("site change alerts", () => {
  it("reports each commit once", async () => {
    const commits = [{ sha: "abc1234", author: "dev", message: "hotfix" }];
    expect(
      await SiteChangeAlertService.report({ projectId: project, commits }),
    ).toEqual({
      inserted: 1,
      alreadyKnown: 0,
    });
    expect(
      await SiteChangeAlertService.report({ projectId: project, commits }),
    ).toEqual({
      inserted: 0,
      alreadyKnown: 1,
    });
    const [alert] = await SiteChangeAlertService.listOpen(project);
    await SiteChangeAlertService.resolve({
      projectId: project,
      alertId: alert.id,
      userId: "user-1",
    });
    expect(await SiteChangeAlertService.listOpen(project)).toEqual([]);
  });
});
