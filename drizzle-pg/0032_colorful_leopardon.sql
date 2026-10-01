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
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_plan_id_page_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."page_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_site_page_id_site_pages_id_fk" FOREIGN KEY ("site_page_id") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plan_items" ADD CONSTRAINT "page_plan_items_asset_id_content_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."content_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_plans" ADD CONSTRAINT "page_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_project_url_idx" ON "site_pages" USING btree ("project_id","url");--> statement-breakpoint
CREATE INDEX "site_pages_project_language_idx" ON "site_pages" USING btree ("project_id","language");--> statement-breakpoint
CREATE INDEX "page_plan_items_plan_idx" ON "page_plan_items" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "page_plans_project_period_idx" ON "page_plans" USING btree ("project_id","period");--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_target_page_id_site_pages_id_fk" FOREIGN KEY ("target_page_id") REFERENCES "public"."site_pages"("id") ON DELETE set null ON UPDATE no action;