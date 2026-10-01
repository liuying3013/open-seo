CREATE TABLE "candidate_keywords" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer DEFAULT 2840 NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"source" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_keywords" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "candidate_keywords" ADD CONSTRAINT "candidate_keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_keywords_unique_project_keyword_location_language" ON "candidate_keywords" USING btree ("project_id","keyword","location_code","language_code");--> statement-breakpoint
CREATE INDEX "candidate_keywords_project_created_idx" ON "candidate_keywords" USING btree ("project_id","created_at");