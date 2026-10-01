CREATE TABLE "cluster_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"candidate_keyword_id" text NOT NULL,
	"is_representative" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"offer_id" text,
	"name" text NOT NULL,
	"primary_entity" text,
	"entity_category" text,
	"user_job" text,
	"status" text DEFAULT 'new' NOT NULL,
	"status_changed_at" text,
	"intent_vector" text,
	"serp_format_scores" text,
	"platform_acceptance" text,
	"business_value_score" real,
	"business_value_breakdown" text,
	"scored_at" text,
	"rule_version" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"decision_id" text,
	"platform" text NOT NULL,
	"asset_type" text,
	"angle" text,
	"title" text,
	"brief" text,
	"brand_mention_mode" text,
	"draft" text,
	"qa_report" text,
	"target_url" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"published_url" text,
	"published_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_budgets" (
	"project_id" text NOT NULL,
	"date" text NOT NULL,
	"serp_fetches" integer DEFAULT 0 NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"briefs_generated" integer DEFAULT 0 NOT NULL,
	"page_reads" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_budgets_project_id_date_pk" PRIMARY KEY("project_id","date")
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text,
	"decision_type" text NOT NULL,
	"input_snapshot" text,
	"decision" text NOT NULL,
	"reason_summary" text,
	"model" text,
	"prompt_version" text,
	"rule_version" text,
	"confidence" real,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"money_site_page_type" text,
	"platform_plan" text,
	"reason_summary" text,
	"decided_by" text NOT NULL,
	"approved_at" text,
	"superseded_by_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"content" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"margin_tier" text NOT NULL,
	"readiness" text NOT NULL,
	"market_priority" integer DEFAULT 3 NOT NULL,
	"conversion_assets" text,
	"notes" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serp_results" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"rank" integer NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"description" text,
	"result_type" text NOT NULL,
	"platform" text,
	"content_type" text,
	"is_owned" boolean DEFAULT false NOT NULL,
	"is_competitor" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serp_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"device" text DEFAULT 'desktop' NOT NULL,
	"fetched_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"result_count" integer,
	"serp_features" text,
	"r2_key" text
);
--> statement-breakpoint
ALTER TABLE "cluster_keywords" ADD CONSTRAINT "cluster_keywords_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_keywords" ADD CONSTRAINT "cluster_keywords_candidate_keyword_id_candidate_keywords_id_fk" FOREIGN KEY ("candidate_keyword_id") REFERENCES "public"."candidate_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_decision_id_deployment_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."deployment_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_budgets" ADD CONSTRAINT "content_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_decisions" ADD CONSTRAINT "deployment_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_decisions" ADD CONSTRAINT "deployment_decisions_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_results" ADD CONSTRAINT "serp_results_snapshot_id_serp_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."serp_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_snapshots" ADD CONSTRAINT "serp_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_snapshots" ADD CONSTRAINT "serp_snapshots_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cluster_keywords_candidate_keyword_idx" ON "cluster_keywords" USING btree ("candidate_keyword_id");--> statement-breakpoint
CREATE INDEX "cluster_keywords_cluster_idx" ON "cluster_keywords" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "clusters_project_status_idx" ON "clusters" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "content_assets_cluster_idx" ON "content_assets" USING btree ("cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_assets_decision_platform_idx" ON "content_assets" USING btree ("decision_id","platform");--> statement-breakpoint
CREATE INDEX "content_assets_project_status_idx" ON "content_assets" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "decision_log_project_created_idx" ON "decision_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_log_cluster_idx" ON "decision_log" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "deployment_decisions_cluster_idx" ON "deployment_decisions" USING btree ("cluster_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_decisions_one_proposed_per_cluster_idx" ON "deployment_decisions" USING btree ("cluster_id") WHERE "deployment_decisions"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "deployment_decisions_project_status_idx" ON "deployment_decisions" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_packs_cluster_version_idx" ON "evidence_packs" USING btree ("cluster_id","version");--> statement-breakpoint
CREATE INDEX "offers_project_idx" ON "offers" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "serp_results_snapshot_rank_idx" ON "serp_results" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE INDEX "serp_snapshots_project_keyword_fetched_idx" ON "serp_snapshots" USING btree ("project_id","keyword","fetched_at");--> statement-breakpoint
CREATE INDEX "serp_snapshots_cluster_idx" ON "serp_snapshots" USING btree ("cluster_id");