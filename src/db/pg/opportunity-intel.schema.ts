import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// Timestamps are stored as *text* (same column shape as the SQLite schema); see
// the note in pg/app.schema.ts. `isoNow` matches `new Date().toISOString()` so
// DB-defaulted and app-written values sort together lexicographically.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ============================================================================
// Opportunity intel: the cross-border opportunity discovery funnel
// (specs/0012-opportunity-intel.md). Hand-written Postgres mirror of
// ../opportunity-intel.schema.ts — schema-parity.test.ts is the drift guard.
// ============================================================================

export const opportunities = pgTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    // Simplified-Chinese display name (intake LLM; operator-facing lists).
    nameZh: text("name_zh"),
    type: text("type", {
      enum: [
        "a_b2b_gap",
        "b_ecosystem",
        "c_hobby",
        "d_ip_spillover",
        "e_service_automation",
        "other",
      ],
    }).notNull(),
    status: text("status", {
      enum: [
        "discovered",
        "keyword_scanned",
        "serp_validated",
        "competitor_validated",
        "buyer_validated",
        "supply_validated",
        "economics_validated",
        "shortlisted",
        "graduated",
        "rejected",
        "watchlist",
        "paused",
      ],
    })
      .notNull()
      .default("discovered"),
    statusChangedAt: text("status_changed_at"),
    source: text("source").notNull().default("manual"),
    seedNotes: text("seed_notes"),
    description: text("description"),
    targetCountries: text("target_countries").notNull(),
    languageCode: text("language_code").notNull().default("en"),
    ipRisk: text("ip_risk", { enum: ["green", "yellow", "red", "unknown"] })
      .notNull()
      .default("unknown"),
    estimatedUnitPriceUsd: real("estimated_unit_price_usd"),
    latestScore: real("latest_score"),
    latestConfidence: real("latest_confidence"),
    latestScoreVersion: text("latest_score_version"),
    graduatedProjectId: text("graduated_project_id").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("opportunities_organization_name_idx").on(
      table.organizationId,
      table.normalizedName,
    ),
    index("opportunities_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);

export const opportunityRelationships = pgTable(
  "opportunity_relationships",
  {
    id: text("id").primaryKey(),
    fromOpportunityId: text("from_opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    toOpportunityId: text("to_opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    relation: text("relation", {
      enum: ["parent", "derived_from", "similar_to"],
    }).notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("opportunity_relationships_edge_idx").on(
      table.fromOpportunityId,
      table.toOpportunityId,
      table.relation,
    ),
    index("opportunity_relationships_to_idx").on(table.toOpportunityId),
  ],
);

export const opportunityKeywords = pgTable(
  "opportunity_keywords",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    role: text("role", {
      enum: [
        "seed",
        "commercial",
        "service",
        "problem",
        "model",
        "supplier",
        "buyer",
        "comparison",
        "info",
      ],
    }).notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull().default("en"),
    searchVolume: integer("search_volume"),
    cpc: real("cpc"),
    competition: real("competition"),
    keywordDifficulty: integer("keyword_difficulty"),
    intent: text("intent"),
    trend: text("trend"),
    metricsFetchedAt: text("metrics_fetched_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("opportunity_keywords_unique_idx").on(
      table.opportunityId,
      table.keyword,
      table.locationCode,
      table.languageCode,
    ),
  ],
);

export const opportunitySerpSnapshots = pgTable(
  "opportunity_serp_snapshots",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    locationCode: integer("location_code").notNull(),
    languageCode: text("language_code").notNull().default("en"),
    device: text("device", { enum: ["desktop", "mobile"] })
      .notNull()
      .default("desktop"),
    fetchedAt: text("fetched_at").notNull().default(isoNow),
    resultCount: integer("result_count"),
    serpFeatures: text("serp_features"),
    gapSignals: text("gap_signals"),
    gapScore: real("gap_score"),
    r2Key: text("r2_key"),
  },
  (table) => [
    index("opportunity_serp_snapshots_opp_keyword_fetched_idx").on(
      table.opportunityId,
      table.keyword,
      table.fetchedAt,
    ),
  ],
);

export const opportunitySerpResults = pgTable(
  "opportunity_serp_results",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => opportunitySerpSnapshots.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    description: text("description"),
    resultType: text("result_type").notNull(),
    platform: text("platform"),
    pageClass: text("page_class"),
  },
  (table) => [
    index("opportunity_serp_results_snapshot_rank_idx").on(
      table.snapshotId,
      table.rank,
    ),
  ],
);

export const opportunityScores = pgTable(
  "opportunity_scores",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: ["keyword", "serp"] }).notNull(),
    score: real("score").notNull(),
    confidence: real("confidence").notNull(),
    scoreVersion: text("score_version").notNull(),
    breakdown: text("breakdown").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("opportunity_scores_opp_created_idx").on(
      table.opportunityId,
      table.createdAt,
    ),
  ],
);

export const opportunityDecisionLog = pgTable(
  "opportunity_decision_log",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    decisionType: text("decision_type").notNull(),
    inputSnapshot: text("input_snapshot"),
    decision: text("decision").notNull(),
    reasonSummary: text("reason_summary"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    ruleVersion: text("rule_version"),
    confidence: real("confidence"),
    createdBy: text("created_by", {
      enum: ["system", "user", "agent"],
    }).notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("opportunity_decision_log_opp_created_idx").on(
      table.opportunityId,
      table.createdAt,
    ),
  ],
);

export const opportunityRuns = pgTable(
  "opportunity_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["scan", "report"] }).notNull(),
    status: text("status", {
      enum: ["running", "done", "failed", "paused"],
    })
      .notNull()
      .default("running"),
    startedAt: text("started_at").notNull().default(isoNow),
    finishedAt: text("finished_at"),
    stats: text("stats"),
    error: text("error"),
  },
  (table) => [
    index("opportunity_runs_organization_started_idx").on(
      table.organizationId,
      table.startedAt,
    ),
    uniqueIndex("opportunity_runs_one_active_per_org_kind_idx")
      .on(table.organizationId, table.kind)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const opportunityReports = pgTable(
  "opportunity_reports",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["daily", "detail"] }).notNull(),
    reportDate: text("report_date").notNull(),
    opportunityId: text("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    runId: text("run_id").references(() => opportunityRuns.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    data: text("data").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("opportunity_reports_organization_kind_date_idx").on(
      table.organizationId,
      table.kind,
      table.reportDate,
    ),
    index("opportunity_reports_opp_idx").on(table.opportunityId),
  ],
);

export const opportunityCostEvents = pgTable(
  "opportunity_cost_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["dataforseo", "openrouter"],
    }).notNull(),
    endpoint: text("endpoint").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    costUsd: real("cost_usd"),
    opportunityId: text("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    runId: text("run_id").references(() => opportunityRuns.id, {
      onDelete: "set null",
    }),
    date: text("date").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("opportunity_cost_events_organization_date_idx").on(
      table.organizationId,
      table.date,
    ),
    index("opportunity_cost_events_opp_idx").on(table.opportunityId),
  ],
);

export const opportunityBudgets = pgTable(
  "opportunity_budgets",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    llmCalls: integer("llm_calls").notNull().default(0),
    keywordLookups: integer("keyword_lookups").notNull().default(0),
    serpFetches: integer("serp_fetches").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.date] })],
);
