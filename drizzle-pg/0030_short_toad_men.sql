CREATE TABLE "project_markets" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"url_prefix" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_sites" (
	"project_id" text PRIMARY KEY NOT NULL,
	"domain" text,
	"business_group" text,
	"brand" text,
	"site_role" text DEFAULT 'other' NOT NULL,
	"ops_status" text DEFAULT 'pending' NOT NULL,
	"github_repo" text,
	"production_branch" text,
	"hosting" text DEFAULT 'unknown' NOT NULL,
	"coolify_app_uuid" text,
	"coolify_server" text,
	"auto_deploy" boolean,
	"template_family" text,
	"content_format" text DEFAULT 'unknown' NOT NULL,
	"plausible_site" text,
	"gsc_property" text,
	"notes" text,
	"imported_at" text,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "project_markets" ADD CONSTRAINT "project_markets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sites" ADD CONSTRAINT "project_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_markets_unique_project_location_language" ON "project_markets" USING btree ("project_id","location_code","language_code");--> statement-breakpoint
CREATE UNIQUE INDEX "project_markets_one_primary_per_project_idx" ON "project_markets" USING btree ("project_id") WHERE "project_markets"."is_primary";--> statement-breakpoint
CREATE INDEX "project_markets_project_idx" ON "project_markets" USING btree ("project_id");