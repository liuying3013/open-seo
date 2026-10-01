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
import { candidateKeywords } from "./candidate-keywords.schema";

// ============================================================================
// Content ops: the SERP deployment decision system (specs/0011-content-ops.md).
// Keyword clusters flow keyword -> cluster -> SERP -> intent -> score ->
// deployment decision -> evidence pack -> brief. The database is the only
// state; the driving agent (Cursor via MCP) never holds pipeline state.
// ============================================================================

// What the business can actually sell and fulfill. Business-value scoring reads
// margin/readiness/priority from the offer a cluster serves, so keywords are
// ranked by commercial reality instead of search volume.
export const offers = sqliteTable(
  "offers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    marginTier: text("margin_tier", { enum: ["high", "mid", "low"] }).notNull(),
    readiness: text("readiness", {
      enum: ["ready", "partial", "none"],
    }).notNull(),
    // 1 (highest) .. 5 (lowest) target-market priority.
    marketPriority: integer("market_priority").notNull().default(3),
    // JSON: { landingPage?: string, whatsapp?: boolean, rfqForm?: string }
    conversionAssets: text("conversion_assets"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [index("offers_project_idx").on(table.projectId)],
);

// A keyword cluster is the unit the pipeline operates on. Latest scores live
// here as JSON columns (only the current view); score history is reconstructed
// from decision_log input snapshots, so no versioned score table is needed.
export const clusters = sqliteTable(
  "clusters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    offerId: text("offer_id").references(() => offers.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    // e.g. "ABB ACS580", "Flexible Travertine"
    primaryEntity: text("primary_entity"),
    // Project-defined vocabulary (HeyMaterials: MCM | NATURAL_FLEXIBLE_STONE |
    // PU_STONE | PORCELAIN | NATURAL_STONE | OTHER | AMBIGUOUS). AMBIGUOUS
    // blocks scoring/deciding until SERP-based disambiguation resolves it.
    entityCategory: text("entity_category"),
    // learn | compare | choose | source | troubleshoot | verify | buy
    userJob: text("user_job"),
    status: text("status", {
      enum: [
        "new",
        "pre_scored",
        "serp_pending",
        "serp_ready",
        "scored",
        "decided",
        "brief_ready",
        "on_hold",
        "archived",
      ],
    })
      .notNull()
      .default("new"),
    statusChangedAt: text("status_changed_at"),
    // JSON {informational, commercial, transactional, navigational} 0..1 each
    intentVector: text("intent_vector"),
    // JSON {guide, comparison, product, forum, qna, video, pdf, ...} rank-weighted
    serpFormatScores: text("serp_format_scores"),
    // JSON {reddit, quora, youtube, medium, pinterest, linkedin, ...} 0..1
    platformAcceptance: text("platform_acceptance"),
    businessValueScore: real("business_value_score"),
    // JSON of weighted subscores including the agent-supplied judgment inputs,
    // kept so scores stay inspectable and re-runnable as rules evolve.
    businessValueBreakdown: text("business_value_breakdown"),
    scoredAt: text("scored_at"),
    // Scoring constants version (see content-ops rules module) used at scoredAt.
    ruleVersion: text("rule_version"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // The pipeline is driven by "what clusters are at stage X" queries.
    index("clusters_project_status_idx").on(table.projectId, table.status),
  ],
);

export const clusterKeywords = sqliteTable(
  "cluster_keywords",
  {
    id: text("id").primaryKey(),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    candidateKeywordId: text("candidate_keyword_id")
      .notNull()
      .references(() => candidateKeywords.id, { onDelete: "cascade" }),
    // SERPs are fetched for representative keywords only (cost control).
    isRepresentative: integer("is_representative", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    // A keyword belongs to at most ONE cluster. This is the in-project
    // cannibalization guard: two clusters can never claim the same query.
    uniqueIndex("cluster_keywords_candidate_keyword_idx").on(
      table.candidateKeywordId,
    ),
    index("cluster_keywords_cluster_idx").on(table.clusterId),
  ],
);

// One row per SERP fetch (a point-in-time snapshot). Refetching the same
// keyword appends a new snapshot; rows are pruned by the retention job, and the
// full raw DataForSEO payload is offloaded to R2 (r2Key), not stored here.
export const serpSnapshots = sqliteTable(
  "serp_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Provenance only — snapshots survive cluster edits/deletes.
    clusterId: text("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
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
    r2Key: text("r2_key"),
  },
  (table) => [
    index("serp_snapshots_project_keyword_fetched_idx").on(
      table.projectId,
      table.keyword,
      table.fetchedAt,
    ),
    index("serp_snapshots_cluster_idx").on(table.clusterId),
  ],
);

// One row per result in a snapshot, mechanically classified at fetch time
// (item type, domain->platform map, owned/competitor flags) with the LLM
// content-type pass filled in by analyze_cluster.
export const serpResults = sqliteTable(
  "serp_results",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => serpSnapshots.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    description: text("description"),
    // DataForSEO item type: organic | video | people_also_ask | discussion |
    // ai_overview | featured_snippet | image | ...
    resultType: text("result_type").notNull(),
    // reddit | quora | youtube | medium | pinterest | linkedin | slideshare |
    // scribd | github | devto | facebook | null (= regular website)
    platform: text("platform"),
    // product | category | commercial_landing | guide | comparison | listicle |
    // forum_thread | qna | video | pdf | brand_home | other
    contentType: text("content_type"),
    isOwned: integer("is_owned", { mode: "boolean" }).notNull().default(false),
    isCompetitor: integer("is_competitor", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("serp_results_snapshot_rank_idx").on(table.snapshotId, table.rank),
  ],
);

// The deployment plan for a cluster: which money-site page type to build and
// which third-party platforms to deploy/test/hold/skip. Proposals are agent-
// generated; approval is a human act and is what creates content_assets rows.
// Re-decisions insert a new row and mark the old one superseded.
export const deploymentDecisions = sqliteTable(
  "deployment_decisions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["proposed", "approved", "rejected", "superseded"],
    })
      .notNull()
      .default("proposed"),
    // product | category | commercial_landing | guide | comparison | listicle |
    // application | faq | database | technical_reference | none
    moneySitePageType: text("money_site_page_type"),
    // JSON array: [{ platform, verdict: DEPLOY|TEST|HOLD|SKIP, score,
    //   subscores, angleHint }]
    platformPlan: text("platform_plan"),
    reasonSummary: text("reason_summary"),
    decidedBy: text("decided_by", { enum: ["agent", "user"] }).notNull(),
    approvedAt: text("approved_at"),
    // Plain text (no FK): points at the decision that replaced this one.
    supersededById: text("superseded_by_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("deployment_decisions_cluster_idx").on(table.clusterId),
    uniqueIndex("deployment_decisions_one_proposed_per_cluster_idx")
      .on(table.clusterId)
      .where(sql`${table.status} = 'proposed'`),
    index("deployment_decisions_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

// Append-only audit trail for every consequential judgment (clustering,
// disambiguation, scoring, platform plans, briefs). Never updated or deleted;
// input_snapshot is what makes "why did we decide this back then" answerable.
export const decisionLog = sqliteTable(
  "decision_log",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    // clustering | entity_disambiguation | pre_score | scoring | page_type |
    // platform_plan | brief | other
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
      enum: ["agent", "user", "system"],
    }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("decision_log_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("decision_log_cluster_idx").on(table.clusterId),
  ],
);

// The master evidence pack per cluster (versioned). Every platform asset is
// generated FROM an approved pack so different platforms share facts but never
// share prose. `content` is a Zod-validated JSON document.
export const evidencePacks = sqliteTable(
  "evidence_packs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status", { enum: ["draft", "approved"] })
      .notNull()
      .default("draft"),
    content: text("content").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("evidence_packs_cluster_version_idx").on(
      table.clusterId,
      table.version,
    ),
  ],
);

// One row per planned platform asset for a cluster (created on decision
// approval). MVP stops at brief_ready; the later statuses belong to phase 2+.
export const contentAssets = sqliteTable(
  "content_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => clusters.id, { onDelete: "cascade" }),
    decisionId: text("decision_id").references(() => deploymentDecisions.id, {
      onDelete: "set null",
    }),
    // money_site | medium | youtube | pinterest | linkedin | reddit | quora |
    // pdf | other
    platform: text("platform").notNull(),
    // page type for money_site; article | video_script | pin | post | thread |
    // answer | document | visual_post for the rest
    assetType: text("asset_type"),
    // The differentiated angle. Platforms must not share one (enforced in the
    // brief service), per the no-cross-platform-copy rule.
    angle: text("angle"),
    title: text("title"),
    brief: text("brief"),
    // author_attribution | experience | resource | cta
    brandMentionMode: text("brand_mention_mode"),
    // The generated article (markdown). Separate from `brief` so a redraft
    // never destroys the instructions it was written from.
    draft: text("draft"),
    // JSON QA report: findings by dimension, the verdict, and how many
    // auto-fix rounds were spent. Kept so a pass/fail can be argued with.
    qaReport: text("qa_report"),
    // Planned money-site path for money_site assets.
    targetUrl: text("target_url"),
    status: text("status", {
      enum: [
        "planned",
        "brief_ready",
        "drafted",
        "qa_review",
        "ready_to_publish",
        "published",
        "indexed",
        "ranking",
        "optimize",
        "refresh",
        "retired",
        "rejected",
      ],
    })
      .notNull()
      .default("planned"),
    publishedUrl: text("published_url"),
    publishedAt: text("published_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    index("content_assets_cluster_idx").on(table.clusterId),
    uniqueIndex("content_assets_decision_platform_idx").on(
      table.decisionId,
      table.platform,
    ),
    index("content_assets_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);

// Per-project per-day counters guarding runaway agent loops. Charged tools
// consume from these before executing and fail closed at the limit.
export const contentBudgets = sqliteTable(
  "content_budgets",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // YYYY-MM-DD (UTC), server-stamped.
    date: text("date").notNull(),
    serpFetches: integer("serp_fetches").notNull().default(0),
    llmCalls: integer("llm_calls").notNull().default(0),
    briefsGenerated: integer("briefs_generated").notNull().default(0),
    // Ranking-page body reads (specs/0013 section 8.9). Free via the same-runtime
    // fetcher, billed when it falls back to DataForSEO content parsing — either
    // way a runaway loop must not read unbounded pages.
    pageReads: integer("page_reads").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.date] })],
);
