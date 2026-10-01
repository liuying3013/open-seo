CREATE TABLE "knowledge_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"knowledge_id" text NOT NULL,
	"conflicting_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" text,
	"resolved_by" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_deltas" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text,
	"asset_id" text,
	"ran_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"supported_count" integer DEFAULT 0 NOT NULL,
	"corrected_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"reused_only" boolean DEFAULT false NOT NULL,
	"summary" text,
	"model" text,
	"prompt_version" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"claim_type" text NOT NULL,
	"category" text NOT NULL,
	"statement" text NOT NULL,
	"normalized_statement" text NOT NULL,
	"entity" text,
	"applicability" text,
	"numeric_value" real,
	"numeric_unit" text,
	"status" text DEFAULT 'candidate' NOT NULL,
	"scope" text DEFAULT 'internal' NOT NULL,
	"source_quality" text,
	"model_confidence" real,
	"verified_at" text,
	"verified_by" text,
	"recheck_after" text,
	"supersedes_id" text,
	"rule_version" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_id" text NOT NULL,
	"research_page_id" text,
	"source_type" text NOT NULL,
	"url" text,
	"excerpt" text,
	"locator" text,
	"captured_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"is_independent" boolean DEFAULT true NOT NULL,
	"is_own_content" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"evidence_pack_id" text,
	"used_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text,
	"serp_result_id" text,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"fetched_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"fetch_method" text NOT NULL,
	"fetch_status" text NOT NULL,
	"http_status" integer,
	"title" text,
	"body_text" text,
	"object_key" text,
	"content_hash" text,
	"word_count" integer
);
--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_knowledge_id_knowledge_entries_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_conflicts" ADD CONSTRAINT "knowledge_conflicts_conflicting_id_knowledge_entries_id_fk" FOREIGN KEY ("conflicting_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_deltas" ADD CONSTRAINT "knowledge_deltas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_deltas" ADD CONSTRAINT "knowledge_deltas_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_deltas" ADD CONSTRAINT "knowledge_deltas_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_knowledge_id_knowledge_entries_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_research_page_id_research_pages_id_fk" FOREIGN KEY ("research_page_id") REFERENCES "public"."research_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_usages" ADD CONSTRAINT "knowledge_usages_knowledge_id_knowledge_entries_id_fk" FOREIGN KEY ("knowledge_id") REFERENCES "public"."knowledge_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_usages" ADD CONSTRAINT "knowledge_usages_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_usages" ADD CONSTRAINT "knowledge_usages_evidence_pack_id_evidence_packs_id_fk" FOREIGN KEY ("evidence_pack_id") REFERENCES "public"."evidence_packs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_pages" ADD CONSTRAINT "research_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_pages" ADD CONSTRAINT "research_pages_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_pages" ADD CONSTRAINT "research_pages_serp_result_id_serp_results_id_fk" FOREIGN KEY ("serp_result_id") REFERENCES "public"."serp_results"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_conflicts_project_status_idx" ON "knowledge_conflicts" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_deltas_project_ran_idx" ON "knowledge_deltas" USING btree ("project_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entries_project_statement_idx" ON "knowledge_entries" USING btree ("project_id","normalized_statement");--> statement-breakpoint
CREATE INDEX "knowledge_entries_project_status_idx" ON "knowledge_entries" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "knowledge_entries_entity_idx" ON "knowledge_entries" USING btree ("project_id","entity");--> statement-breakpoint
CREATE INDEX "knowledge_sources_knowledge_idx" ON "knowledge_sources" USING btree ("knowledge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_usages_knowledge_asset_idx" ON "knowledge_usages" USING btree ("knowledge_id","asset_id");--> statement-breakpoint
CREATE INDEX "knowledge_usages_asset_idx" ON "knowledge_usages" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "research_pages_project_url_fetched_idx" ON "research_pages" USING btree ("project_id","url","fetched_at");--> statement-breakpoint
CREATE INDEX "research_pages_cluster_idx" ON "research_pages" USING btree ("cluster_id");