import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { clusters, contentAssets } from "./content-ops.schema";
import { sitePages } from "./site-pages.schema";
import { PAGE_ACTIONS, PAGE_PLAN_STATUSES } from "../../shared/pagePlans";

// Timestamps are text on Postgres; see ./app.schema.ts for why.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// One plan per project per month. Drafts are edited freely; approval is a
// human act in the web app and is what creates the page work orders.
export const pagePlans = pgTable(
  "page_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // YYYY-MM
    period: text("period").notNull(),
    status: text("status", { enum: PAGE_PLAN_STATUSES })
      .notNull()
      .default("draft"),
    notes: text("notes"),
    // Plain text (no FK): the web user who approved the plan.
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: text("approved_at"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("page_plans_project_period_idx").on(
      table.projectId,
      table.period,
    ),
  ],
);

export const pagePlanItems = pgTable(
  "page_plan_items",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => pagePlans.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    action: text("action", { enum: PAGE_ACTIONS }).notNull(),
    targetUrl: text("target_url").notNull(),
    sitePageId: text("site_page_id").references(() => sitePages.id, {
      onDelete: "set null",
    }),
    language: text("language"),
    // 0..100
    score: real("score"),
    scoreReasons: text("score_reasons"),
    // 0..100
    confidence: real("confidence"),
    estCostUsd: real("est_cost_usd"),
    included: boolean("included").notNull().default(true),
    // The page work order created when the plan was approved.
    assetId: text("asset_id").references(() => contentAssets.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [index("page_plan_items_plan_idx").on(table.planId)],
);
