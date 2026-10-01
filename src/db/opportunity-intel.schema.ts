import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";
import { organization } from "./better-auth-schema";

// ============================================================================
// Opportunity intel: the cross-border opportunity discovery funnel
// (specs/0012-opportunity-intel.md). Seeds flow seed -> keyword expansion ->
// demand metrics -> SERP gap -> score + confidence -> report -> graduation.
// Discovery data deliberately lives in its OWN tables (data boundary option A):
// it is high-volume, low-trust, and lives or dies in bulk with its opportunity.
// Keywords with paid metrics/SERP are upserted into saved_keywords at fetch
// time. Graduation still sets graduated_project_id and seeds project memory.
// ============================================================================

// One candidate market. Never hard-deleted: rejected rows are the dedup guard
// (the same candidate must never be re-bought) and the audit trail.
export const opportunities = sqliteTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Display name, e.g. "Bike Chain Waxing Station".
    name: text("name").notNull(),
    // lowercase/trim/collapse — deduped within one organization.
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
        // V0.2+ stages, defined now so the vocabulary is stable:
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
    // manual (V0.2 adds llm_expansion | source-adapter ids).
    source: text("source").notNull().default("manual"),
    // What the human knew at intake.
    seedNotes: text("seed_notes"),
    // LLM-written definition of the opportunity (intake pass, logged).
    description: text("description"),
    // JSON array of ISO country codes, e.g. ["US","GB"].
    targetCountries: text("target_countries").notNull(),
    languageCode: text("language_code").notNull().default("en"),
    ipRisk: text("ip_risk", { enum: ["green", "yellow", "red", "unknown"] })
      .notNull()
      .default("unknown"),
    // Intake-LLM estimate of the core product's typical unit price (USD).
    // Null for rows created before the operator's $500 ticket-floor rule.
    estimatedUnitPriceUsd: real("estimated_unit_price_usd"),
    // Denormalized from opportunity_scores for cheap list queries.
    latestScore: real("latest_score"),
    latestConfidence: real("latest_confidence"),
    latestScoreVersion: text("latest_score_version"),
    // The ONLY link into the project world, set by graduation.
    graduatedProjectId: text("graduated_project_id").references(
      () => projects.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("opportunities_organization_name_idx").on(
      table.organizationId,
      table.normalizedName,
    ),
    // The batch runner is driven by "what opportunities are at stage X".
    index("opportunities_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);

// The opportunity graph: parent ecosystems, derivations, similarity. V0.1
// fills it from intake hints; V0.2 tree expansion builds on it.
export const opportunityRelationships = sqliteTable(
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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

// Discovery-scale keywords with metrics inline — deliberately NOT
// saved_keywords/keyword_metrics: discovery tolerates coarse staleness and its
// rows die in bulk with the opportunity. Survivors are promoted into
// saved_keywords (source='opportunity') at graduation. Zero-volume rows are
// KEPT (PRD §11: SV=0 does not mean worthless for type A/E).
export const opportunityKeywords = sqliteTable(
  "opportunity_keywords",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    // Normalized (lowercase/trim/collapse).
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
    // Null = metrics fetched but the provider returned nothing.
    searchVolume: integer("search_volume"),
    cpc: real("cpc"),
    competition: real("competition"),
    keywordDifficulty: integer("keyword_difficulty"),
    // LLM fine taxonomy (informational | commercial | transactional |
    // navigational | service | supplier | replacement | model | problem).
    intent: text("intent"),
    // JSON monthly series as provided.
    trend: text("trend"),
    metricsFetchedAt: text("metrics_fetched_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // Metrics upsert idempotency root; its prefix also serves per-opportunity
    // list queries.
    uniqueIndex("opportunity_keywords_unique_idx").on(
      table.opportunityId,
      table.keyword,
      table.locationCode,
      table.languageCode,
    ),
  ],
);

// One row per SERP fetch — mirrors serp_snapshots but opportunity-rooted, and
// carries the supply-gap analysis (there is no separate analyze step table).
// Refetching appends a new snapshot; retention prunes old ones.
export const opportunitySerpSnapshots = sqliteTable(
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
    fetchedAt: text("fetched_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    resultCount: integer("result_count"),
    // JSON list of SERP features present: paa | discussions_forums |
    // video_pack | ai_overview | images | related_searches | ...
    serpFeatures: text("serp_features"),
    // JSON from the LLM gap pass: { intentMismatch, marketplaceDominance,
    // outdatedShare, weakDomainShare, dedicatedSupplierCount, notes }.
    gapSignals: text("gap_signals"),
    // 0..100 per-snapshot supply-gap arithmetic (rules module).
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

// One row per result in a snapshot: mechanical classification at fetch time
// (item type, domain->platform), LLM page_class from the gap pass. No
// is_owned/is_competitor — those are project concepts.
export const opportunitySerpResults = sqliteTable(
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
    // DataForSEO item type: organic | video | people_also_ask | ...
    resultType: text("result_type").notNull(),
    // reddit | quora | youtube | medium | pinterest | linkedin | ... | null.
    platform: text("platform"),
    // supplier | manufacturer | distributor | marketplace | niche_store |
    // brand_home | guide | comparison | forum_thread | qna | video | pdf |
    // directory | social | news | other
    pageClass: text("page_class"),
  },
  (table) => [
    index("opportunity_serp_results_snapshot_rank_idx").on(
      table.snapshotId,
      table.rank,
    ),
  ],
);

// Score history: one row per compute (re-scoring under a new rule version is
// an insert, never an update). The latest row is denormalized onto
// opportunities.latest_*.
export const opportunityScores = sqliteTable(
  "opportunity_scores",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    // Evidence depth at compute time (V0.2+ adds deeper stages).
    stage: text("stage", { enum: ["keyword", "serp"] }).notNull(),
    score: real("score").notNull(),
    // Pure arithmetic from evidence counts/recency — no LLM input.
    confidence: real("confidence").notNull(),
    scoreVersion: text("score_version").notNull(),
    // JSON: raw inputs, weighted subscores, dimensions renormalized away,
    // the bounded LLM adjustment.
    breakdown: text("breakdown").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("opportunity_scores_opp_created_idx").on(
      table.opportunityId,
      table.createdAt,
    ),
  ],
);

// Append-only audit trail for every consequential judgment in the funnel.
// Never updated or deleted (opportunities are never hard-deleted, so the
// cascade FK is safe).
export const opportunityDecisionLog = sqliteTable(
  "opportunity_decision_log",
  {
    id: text("id").primaryKey(),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    // intake | keyword_expansion | intent_classification | serp_gap_analysis |
    // scoring | gate_transition | report | review | graduation
    decisionType: text("decision_type").notNull(),
    // JSON of the data considered at decision time.
    inputSnapshot: text("input_snapshot"),
    // JSON or prose of what was decided.
    decision: text("decision").notNull(),
    reasonSummary: text("reason_summary"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    ruleVersion: text("rule_version"),
    confidence: real("confidence"),
    createdBy: text("created_by", {
      enum: ["system", "user", "agent"],
    }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("opportunity_decision_log_opp_created_idx").on(
      table.opportunityId,
      table.createdAt,
    ),
  ],
);

// Batch-run bookkeeping. Resumability does not live here — stages select work
// by opportunity status — but runs record what happened and what it cost.
export const opportunityRuns = sqliteTable(
  "opportunity_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["scan", "report"] }).notNull(),
    // paused = a budget gate stopped the run; the next run picks up the rest.
    status: text("status", {
      enum: ["running", "done", "failed", "paused"],
    })
      .notNull()
      .default("running"),
    startedAt: text("started_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    finishedAt: text("finished_at"),
    // JSON per-stage counters: { processed, advanced, rejected, watchlisted,
    // errors } plus costUsd.
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

// The human deliverable: generated markdown plus the Zod-validated structured
// evidence (`data`) the narrative is constrained to.
export const opportunityReports = sqliteTable(
  "opportunity_reports",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["daily", "detail"] }).notNull(),
    // YYYY-MM-DD (UTC), server-stamped.
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
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
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

// Per-provider cost ledger (PRD §29). Budget reservations live in the atomic
// counters below; this table feeds spend reporting, per-opportunity attribution,
// and cost-per-shortlisted.
export const opportunityCostEvents = sqliteTable(
  "opportunity_cost_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["dataforseo", "openrouter"],
    }).notNull(),
    // labs_keyword_metrics | serp_advanced | llm_intake | llm_expand |
    // llm_intent | llm_gap | llm_analysis | llm_report
    endpoint: text("endpoint").notNull(),
    requestCount: integer("request_count").notNull().default(1),
    // Provider-reported when available, else rules-estimated.
    costUsd: real("cost_usd"),
    opportunityId: text("opportunity_id").references(() => opportunities.id, {
      onDelete: "set null",
    }),
    runId: text("run_id").references(() => opportunityRuns.id, {
      onDelete: "set null",
    }),
    // YYYY-MM-DD (UTC), server-stamped; the daily budget aggregation key.
    date: text("date").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("opportunity_cost_events_organization_date_idx").on(
      table.organizationId,
      table.date,
    ),
    index("opportunity_cost_events_opp_idx").on(table.opportunityId),
  ],
);

// Atomic per-organization request counters. The cost ledger above remains the
// reporting source; this table exists only so concurrent provider calls cannot
// jointly pass a read-then-write budget check.
export const opportunityBudgets = sqliteTable(
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
