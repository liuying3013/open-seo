CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"name_zh" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"status_changed_at" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"seed_notes" text,
	"description" text,
	"target_countries" text NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"ip_risk" text DEFAULT 'unknown' NOT NULL,
	"estimated_unit_price_usd" real,
	"latest_score" real,
	"latest_confidence" real,
	"latest_score_version" text,
	"graduated_project_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_budgets" (
	"organization_id" text NOT NULL,
	"date" text NOT NULL,
	"llm_calls" integer DEFAULT 0 NOT NULL,
	"keyword_lookups" integer DEFAULT 0 NOT NULL,
	"serp_fetches" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "opportunity_budgets_organization_id_date_pk" PRIMARY KEY("organization_id","date")
);
--> statement-breakpoint
CREATE TABLE "opportunity_cost_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"cost_usd" real,
	"opportunity_id" text,
	"run_id" text,
	"date" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_decision_log" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
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
CREATE TABLE "opportunity_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"keyword" text NOT NULL,
	"role" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"search_volume" integer,
	"cpc" real,
	"competition" real,
	"keyword_difficulty" integer,
	"intent" text,
	"trend" text,
	"metrics_fetched_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"from_opportunity_id" text NOT NULL,
	"to_opportunity_id" text NOT NULL,
	"relation" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"report_date" text NOT NULL,
	"opportunity_id" text,
	"run_id" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"data" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"finished_at" text,
	"stats" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"stage" text NOT NULL,
	"score" real NOT NULL,
	"confidence" real NOT NULL,
	"score_version" text NOT NULL,
	"breakdown" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_serp_results" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"rank" integer NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"description" text,
	"result_type" text NOT NULL,
	"platform" text,
	"page_class" text
);
--> statement-breakpoint
CREATE TABLE "opportunity_serp_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"device" text DEFAULT 'desktop' NOT NULL,
	"fetched_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"result_count" integer,
	"serp_features" text,
	"gap_signals" text,
	"gap_score" real,
	"r2_key" text
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_graduated_project_id_projects_id_fk" FOREIGN KEY ("graduated_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_budgets" ADD CONSTRAINT "opportunity_budgets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_cost_events" ADD CONSTRAINT "opportunity_cost_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_cost_events" ADD CONSTRAINT "opportunity_cost_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_cost_events" ADD CONSTRAINT "opportunity_cost_events_run_id_opportunity_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_decision_log" ADD CONSTRAINT "opportunity_decision_log_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_keywords" ADD CONSTRAINT "opportunity_keywords_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_relationships" ADD CONSTRAINT "opportunity_relationships_from_opportunity_id_opportunities_id_fk" FOREIGN KEY ("from_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_relationships" ADD CONSTRAINT "opportunity_relationships_to_opportunity_id_opportunities_id_fk" FOREIGN KEY ("to_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reports" ADD CONSTRAINT "opportunity_reports_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reports" ADD CONSTRAINT "opportunity_reports_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_reports" ADD CONSTRAINT "opportunity_reports_run_id_opportunity_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."opportunity_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_runs" ADD CONSTRAINT "opportunity_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_serp_results" ADD CONSTRAINT "opportunity_serp_results_snapshot_id_opportunity_serp_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."opportunity_serp_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_serp_snapshots" ADD CONSTRAINT "opportunity_serp_snapshots_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_organization_name_idx" ON "opportunities" USING btree ("organization_id","normalized_name");--> statement-breakpoint
CREATE INDEX "opportunities_organization_status_idx" ON "opportunities" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "opportunity_cost_events_organization_date_idx" ON "opportunity_cost_events" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "opportunity_cost_events_opp_idx" ON "opportunity_cost_events" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_decision_log_opp_created_idx" ON "opportunity_decision_log" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_keywords_unique_idx" ON "opportunity_keywords" USING btree ("opportunity_id","keyword","location_code","language_code");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_relationships_edge_idx" ON "opportunity_relationships" USING btree ("from_opportunity_id","to_opportunity_id","relation");--> statement-breakpoint
CREATE INDEX "opportunity_relationships_to_idx" ON "opportunity_relationships" USING btree ("to_opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_reports_organization_kind_date_idx" ON "opportunity_reports" USING btree ("organization_id","kind","report_date");--> statement-breakpoint
CREATE INDEX "opportunity_reports_opp_idx" ON "opportunity_reports" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_runs_organization_started_idx" ON "opportunity_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_runs_one_active_per_org_kind_idx" ON "opportunity_runs" USING btree ("organization_id","kind") WHERE "opportunity_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "opportunity_scores_opp_created_idx" ON "opportunity_scores" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "opportunity_serp_results_snapshot_rank_idx" ON "opportunity_serp_results" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE INDEX "opportunity_serp_snapshots_opp_keyword_fetched_idx" ON "opportunity_serp_snapshots" USING btree ("opportunity_id","keyword","fetched_at");