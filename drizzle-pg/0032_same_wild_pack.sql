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
CREATE INDEX "content_asset_approvals_asset_idx" ON "content_asset_approvals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "content_asset_comments_asset_idx" ON "content_asset_comments" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_asset_versions_asset_version_idx" ON "content_asset_versions" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "publish_attempts_asset_idx" ON "publish_attempts" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "publish_attempts_status_idx" ON "publish_attempts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "site_change_alerts_project_commit_idx" ON "site_change_alerts" USING btree ("project_id","commit_sha");