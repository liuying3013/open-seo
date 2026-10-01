import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { contentAssets } from "./content-ops.schema";
import {
  APPROVAL_DECISIONS,
  PUBLISH_ATTEMPT_KINDS,
  PUBLISH_ATTEMPT_STATUSES,
  PUBLISH_ERROR_STAGES,
  VERSION_AUTHORS,
  VERSION_FILE_CHANGES,
} from "../../shared/pagePublishing";

// Timestamps are text on Postgres; see ./app.schema.ts for why.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ============================================================================
// Page publishing: content versions, human approval, publish attempts and
// unapproved-change alerts for money-site page work orders (content_assets).
// A work order's content is versioned; an approval is only valid for the
// version it was given on, so a new version silently voids older approvals.
// ============================================================================

export const contentAssetVersions = pgTable(
  "content_asset_versions",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    // Increments per work order, starting at 1.
    version: integer("version").notNull(),
    // JSON: the structured draft (title, metaDescription, slug, body, ...).
    draft: text("draft").notNull(),
    taskBranch: text("task_branch"),
    baseCommit: text("base_commit"),
    headCommit: text("head_commit"),
    // Stable patch fingerprint of the implementation; what an approval signs.
    patchId: text("patch_id"),
    // Unified diff, truncated to 256KB.
    diffText: text("diff_text"),
    // JSON: deterministic check results.
    checksReport: text("checks_report").notNull(),
    qaReport: text("qa_report"),
    createdBy: text("created_by", { enum: VERSION_AUTHORS }).notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("content_asset_versions_asset_version_idx").on(
      table.assetId,
      table.version,
    ),
  ],
);

export const contentAssetVersionFiles = pgTable(
  "content_asset_version_files",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => contentAssetVersions.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    change: text("change", { enum: VERSION_FILE_CHANGES }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.path] })],
);

export const contentAssetApprovals = pgTable(
  "content_asset_approvals",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    versionId: text("version_id")
      .notNull()
      .references(() => contentAssetVersions.id, { onDelete: "cascade" }),
    patchId: text("patch_id"),
    decision: text("decision", { enum: APPROVAL_DECISIONS }).notNull(),
    comment: text("comment"),
    // Null = publish as soon as possible.
    publishAt: text("publish_at"),
    decidedByUserId: text("decided_by_user_id").notNull(),
    decidedAt: text("decided_at").notNull(),
    revokedAt: text("revoked_at"),
    // Null with revoked_at set = revoked by the system (fingerprint mismatch).
    revokedByUserId: text("revoked_by_user_id"),
  },
  (table) => [index("content_asset_approvals_asset_idx").on(table.assetId)],
);

export const contentAssetComments = pgTable(
  "content_asset_comments",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    versionId: text("version_id").references(() => contentAssetVersions.id, {
      onDelete: "set null",
    }),
    // "system" for server-written notes (e.g. a fingerprint mismatch).
    userId: text("user_id").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [index("content_asset_comments_asset_idx").on(table.assetId)],
);

export const publishAttempts = pgTable(
  "publish_attempts",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    // Null for rollbacks.
    approvalId: text("approval_id").references(() => contentAssetApprovals.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: PUBLISH_ATTEMPT_KINDS }).notNull(),
    status: text("status", { enum: PUBLISH_ATTEMPT_STATUSES })
      .notNull()
      .default("queued"),
    // Set on rollback requests.
    requestedByUserId: text("requested_by_user_id"),
    mergeCommit: text("merge_commit"),
    coolifyDeploymentUuid: text("coolify_deployment_uuid"),
    liveStatusCode: integer("live_status_code"),
    // 0-100 similarity between the approved text and the live page.
    textMatch: integer("text_match"),
    // JSON: noindex flag, canonical and notes from the live check.
    liveCheckSummary: text("live_check_summary"),
    // R2 keys.
    screenshotDesktopKey: text("screenshot_desktop_key"),
    screenshotMobileKey: text("screenshot_mobile_key"),
    errorStage: text("error_stage", { enum: PUBLISH_ERROR_STAGES }),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("publish_attempts_asset_idx").on(table.assetId),
    index("publish_attempts_status_idx").on(table.status),
  ],
);

// Commits on a production branch that have no approval record.
export const siteChangeAlerts = pgTable(
  "site_change_alerts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    commitSha: text("commit_sha").notNull(),
    author: text("author"),
    message: text("message"),
    detectedAt: text("detected_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id"),
  },
  (table) => [
    uniqueIndex("site_change_alerts_project_commit_idx").on(
      table.projectId,
      table.commitSha,
    ),
  ],
);
