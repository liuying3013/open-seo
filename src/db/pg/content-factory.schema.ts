import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";
import {
  clusters,
  contentAssets,
  evidencePacks,
  serpResults,
} from "./content-ops.schema";

// Timestamps are stored as *text* (same column shape as the SQLite schema); see
// the note in pg/app.schema.ts. `isoNow` matches `new Date().toISOString()` so
// DB-defaulted and app-written values sort together lexicographically.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// ============================================================================
// Content factory (specs/0013-content-factory.md).
//
// Content-ops decides *whether and where* to publish from the SERP list alone.
// This domain covers what happens after that decision, starting with the step
// its spec calls mandatory before any writing: actually opening the ranking
// pages and reading their bodies. The knowledge layer (knowledge_entries and
// friends, spec section 8.9) lands on top of this table and is not built yet.
// ============================================================================

// One row per ranking page we opened and tried to read. Rows are kept for
// failures too: "we tried and it was blocked" is the evidence that a fact could
// not be sourced, and it is what puts a page into the evidence pack's
// openQuestions instead of letting the model invent from a title.
//
// This is a time series, not a cache table with one row per URL — refetching
// inserts a new row so an evidence pack can always point at the exact body it
// was built from. `contentHash` is what lets a later fetch say "unchanged"
// without re-parsing (spec section 12).
export const researchPages = pgTable(
  "research_pages",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Provenance only — bodies survive cluster edits/deletes, like SERP
    // snapshots do.
    clusterId: text("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    // Which ranking row sent us here. Set null rather than cascade: SERP
    // retention prunes old snapshots (and their results) long before the
    // bodies stop being useful as evidence.
    serpResultId: text("serp_result_id").references(() => serpResults.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    fetchedAt: text("fetched_at").notNull().default(isoNow),
    // read_pages = the free same-runtime fetch (src/server/lib/scrape.ts);
    // dataforseo_parsing = the paid OnPage Content Parsing endpoint, used when
    // the free path cannot see a JS-rendered page.
    fetchMethod: text("fetch_method", {
      enum: ["read_pages", "dataforseo_parsing"],
    }).notNull(),
    fetchStatus: text("fetch_status", {
      enum: ["ok", "blocked", "timeout", "empty", "not_html", "robots_denied"],
    }).notNull(),
    httpStatus: integer("http_status"),
    title: text("title"),
    // Normalized readable text, capped by the service (not the DB) at
    // RESEARCH_PAGE_BODY_LIMIT. The raw payload goes to object storage under
    // `objectKey`, mirroring the serp_snapshots/r2Key split.
    bodyText: text("body_text"),
    objectKey: text("object_key"),
    // Hash of the normalized body: lets a refetch detect "this page did not
    // change" without re-parsing or re-billing an LLM pass over it.
    contentHash: text("content_hash"),
    wordCount: integer("word_count"),
  },
  (table) => [
    index("research_pages_project_url_fetched_idx").on(
      table.projectId,
      table.url,
      table.fetchedAt,
    ),
    index("research_pages_cluster_idx").on(table.clusterId),
  ],
);

// ============================================================================
// Knowledge layer (specs/0013-content-factory.md section 8.9).
//
// research_pages above holds what a page SAID. These tables hold what we
// concluded from it and may reuse: claims separated by epistemic status, their
// provenance, which assets consumed them, what each task added, and the
// contradictions nobody has resolved yet.
//
// project_context_sections is deliberately not extended for this: it stores
// prose, and project_research_log is pruned at 90 days. Facts must outlive both
// and carry per-claim provenance.
// ============================================================================

// One reusable claim. The four claim_types are kept apart on purpose: a
// measured spec, a business judgment, an observation of a SERP at a moment, and
// an untested hypothesis are not interchangeable evidence, and collapsing them
// is how a guess becomes a "fact" two tasks later.
export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    claimType: text("claim_type", {
      enum: ["fact", "judgment", "observation", "hypothesis"],
    }).notNull(),
    category: text("category", {
      enum: [
        "verified_fact",
        "business_judgment",
        "buyer_question",
        "serp_observation",
        "content_gap",
        "editorial_lesson",
        "known_error",
        "performance_observation",
      ],
    }).notNull(),
    // One assertion, not a paragraph — so it can be cited, superseded and
    // contradicted individually.
    statement: text("statement").notNull(),
    normalizedStatement: text("normalized_statement").notNull(),
    entity: text("entity"),
    // JSON: { model?, config?, market?, audience?, validFrom?, validTo? }.
    // A numeric claim without its model/config conditions is not reusable.
    applicability: text("applicability"),
    numericValue: real("numeric_value"),
    numericUnit: text("numeric_unit"),
    status: text("status", {
      enum: [
        "candidate",
        "approved",
        "needs_review",
        "superseded",
        "retracted",
      ],
    })
      .notNull()
      .default("candidate"),
    // internal never reaches a writing context (spec section 8.8): supplier
    // cost, internal margin, customer identity.
    scope: text("scope", { enum: ["public", "internal"] })
      .notNull()
      .default("internal"),
    sourceQuality: text("source_quality", {
      enum: ["primary", "vendor", "competitor", "community", "derived"],
    }),
    // The model's own confidence. NEVER a substitute for sourceQuality: a
    // confident model reading a weak page is still a weak claim.
    modelConfidence: real("model_confidence"),
    verifiedAt: text("verified_at"),
    verifiedBy: text("verified_by", { enum: ["user", "rule", "model"] }),
    // Per-claim recheck date rather than one global TTL: a fire rating and a
    // price band go stale at very different speeds.
    recheckAfter: text("recheck_after"),
    // Correction chain. The superseded row is kept, never updated in place.
    supersedesId: text("supersedes_id"),
    ruleVersion: text("rule_version"),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    // Dedupe guard: a repeat discovery merges or supersedes, it does not
    // insert a second row.
    uniqueIndex("knowledge_entries_project_statement_idx").on(
      table.projectId,
      table.normalizedStatement,
    ),
    index("knowledge_entries_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    index("knowledge_entries_entity_idx").on(table.projectId, table.entity),
  ],
);

// Where a claim came from. A claim can have several; the flags are what make
// "how many independent sources" answerable.
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    knowledgeId: text("knowledge_id")
      .notNull()
      .references(() => knowledgeEntries.id, { onDelete: "cascade" }),
    // The exact body this was read from, when it was a ranking page.
    researchPageId: text("research_page_id").references(
      () => researchPages.id,
      { onDelete: "set null" },
    ),
    sourceType: text("source_type", {
      enum: [
        "ranking_page",
        "manufacturer_doc",
        "offer",
        "project_memory",
        "gsc",
        "ga4",
        "operator",
        "serp_snapshot",
      ],
    }).notNull(),
    url: text("url"),
    // The sentence that actually supports the claim, so a reviewer can check
    // it without refetching the page.
    excerpt: text("excerpt"),
    locator: text("locator"),
    capturedAt: text("captured_at").notNull().default(isoNow),
    // Syndicated and mutually-rewritten pages count as ONE source between
    // them (spec section 8.6).
    isIndependent: boolean("is_independent").notNull().default(true),
    // Our own published page. A fact whose sources are all our own content is
    // the model citing itself; the service refuses to approve it.
    isOwnContent: boolean("is_own_content").notNull().default(false),
  },
  (table) => [index("knowledge_sources_knowledge_idx").on(table.knowledgeId)],
);

// Impact tracking: retracting a claim has to be able to find the pages that
// used it, or knowledge and published content drift apart silently.
export const knowledgeUsages = pgTable(
  "knowledge_usages",
  {
    id: text("id").primaryKey(),
    knowledgeId: text("knowledge_id")
      .notNull()
      .references(() => knowledgeEntries.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => contentAssets.id, { onDelete: "cascade" }),
    evidencePackId: text("evidence_pack_id").references(
      () => evidencePacks.id,
      { onDelete: "set null" },
    ),
    usedAt: text("used_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("knowledge_usages_knowledge_asset_idx").on(
      table.knowledgeId,
      table.assetId,
    ),
    index("knowledge_usages_asset_idx").on(table.assetId),
  ],
);

// One row per extraction run. "Reused existing knowledge, added nothing" is a
// valid outcome and is recorded as such — the absence of a row means the step
// was skipped, which is not.
export const knowledgeDeltas = pgTable(
  "knowledge_deltas",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id").references(() => clusters.id, {
      onDelete: "set null",
    }),
    assetId: text("asset_id").references(() => contentAssets.id, {
      onDelete: "set null",
    }),
    ranAt: text("ran_at").notNull().default(isoNow),
    addedCount: integer("added_count").notNull().default(0),
    supportedCount: integer("supported_count").notNull().default(0),
    correctedCount: integer("corrected_count").notNull().default(0),
    conflictCount: integer("conflict_count").notNull().default(0),
    reusedOnly: boolean("reused_only").notNull().default(false),
    summary: text("summary"),
    model: text("model"),
    promptVersion: text("prompt_version"),
  },
  (table) => [
    index("knowledge_deltas_project_ran_idx").on(table.projectId, table.ranAt),
  ],
);

// Unresolved contradictions, kept queryable instead of buried in prose. The
// first question on a conflict is whether the two claims simply hold under
// different conditions.
export const knowledgeConflicts = pgTable(
  "knowledge_conflicts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    knowledgeId: text("knowledge_id")
      .notNull()
      .references(() => knowledgeEntries.id, { onDelete: "cascade" }),
    conflictingId: text("conflicting_id")
      .notNull()
      .references(() => knowledgeEntries.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["value_mismatch", "condition_mismatch", "stale", "contradiction"],
    }).notNull(),
    detail: text("detail").notNull(),
    status: text("status", {
      enum: ["open", "resolved_kept", "resolved_superseded", "resolved_scoped"],
    })
      .notNull()
      .default("open"),
    resolvedAt: text("resolved_at"),
    resolvedBy: text("resolved_by"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("knowledge_conflicts_project_status_idx").on(
      table.projectId,
      table.status,
    ),
  ],
);
