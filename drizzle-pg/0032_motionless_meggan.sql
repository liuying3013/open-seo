CREATE TABLE "content_asset_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"version_id" text NOT NULL,
	"patch_id" text,
	"decision" text NOT NULL,
	"comment" text,
	"publish_at" text,
	"decided_by_user_id" text NOT NULL,
	"decided_at" text NOT NULL,
	"revoked_at" text,
	"revoked_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "content_asset_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"version_id" text,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_asset_version_files" (
	"version_id" text NOT NULL,
	"path" text NOT NULL,
	"change" text NOT NULL,
	CONSTRAINT "content_asset_version_files_version_id_path_pk" PRIMARY KEY("version_id","path")
);
--> statement-breakpoint
CREATE TABLE "content_asset_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"version" integer NOT NULL,
	"draft" text NOT NULL,
	"task_branch" text,
	"base_commit" text,
	"head_commit" text,
	"patch_id" text,
	"diff_text" text,
	"checks_report" text NOT NULL,
	"qa_report" text,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"approval_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by_user_id" text,
	"merge_commit" text,
	"coolify_deployment_uuid" text,
	"live_status_code" integer,
	"text_match" integer,
	"live_check_summary" text,
	"screenshot_desktop_key" text,
	"screenshot_mobile_key" text,
	"error_stage" text,
	"error_message" text,
	"started_at" text,
	"finished_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_change_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"author" text,
	"message" text,
	"detected_at" text NOT NULL,
	"resolved_at" text,
	"resolved_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"path" text NOT NULL,
	"language" text,
	"route_file" text,
	"content_file" text,
	"title" text,
	"meta_description" text,
	"h1" text,
	"canonical" text,
	"noindex" boolean DEFAULT false NOT NULL,
	"status_code" integer,
	"page_role" text,
	"in_sitemap" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"last_checked_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_plan_items" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"cluster_id" text,
	"action" text NOT NULL,
	"target_url" text NOT NULL,
	"site_page_id" text,
	"language" text,
	"score" real,
	"score_reasons" text,
	"confidence" real,
	"est_cost_usd" real,
	"included" boolean DEFAULT true NOT NULL,
	"asset_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"approved_by_user_id" text,
	"approved_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "target_page_id" text;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "target_url" text;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "planned_action" text;--> statement-breakpoint
ALTER TABLE "clusters" ADD COLUMN "action_reason" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "page_action" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "site_page_id" text;--> statement-breakpoint
ALTER TABLE "content_assets" ADD COLUMN "current_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_asset_approvals" ADD CONSTRAINT "content_asset_approvals_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_approvals" ADD CONSTRAINT "content_asset_approvals_version_id_content_asset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_comments" ADD CONSTRAINT "content_asset_comments_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_comments" ADD CONSTRAINT "content_asset_comments_version_id_content_asset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_asset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_version_files" ADD CONSTRAINT "content_asset_version_files_version_id_content_asset_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."content_asset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_asset_versions" ADD CONSTRAINT "content_asset_versions_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_approval_id_content_asset_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."content_asset_approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_change_alerts" ADD CONSTRAINT "site_change_alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_plan_id_page_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."page_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_site_page_id_site_pages_id_fk" FOREIGN KEY ("site_page_id") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plans" ADD CONSTRAINT "page_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_asset_approvals_asset_idx" ON "content_asset_approvals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "content_asset_comments_asset_idx" ON "content_asset_comments" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_versions_asset_version_idx" ON "content_asset_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "publish_attempts_asset_idx" ON "publish_attempts" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "publish_attempts_status_idx" ON "publish_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "site_change_alerts_project_commit_idx" ON "site_change_alerts" USING btree ("project_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_project_url_idx" ON "site_pages" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "site_pages_project_language_idx" ON "site_pages" USING btree ("project_id","language");--> statement-breakpoint
CREATE INDEX "page_plan_items_plan_idx" ON "page_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_plans_project_period_idx" ON "page_plans" USING btree ("project_id","period");--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_target_page_id_site_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_site_page_id_site_pages_id_fk" FOREIGN KEY ("site_page_id") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;