CREATE TABLE `project_markets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text NOT NULL,
	`url_prefix` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_markets_unique_project_location_language` ON `project_markets` (`project_id`,`location_code`,`language_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_markets_one_primary_per_project_idx` ON `project_markets` (`project_id`) WHERE "project_markets"."is_primary";--> statement-breakpoint
CREATE INDEX `project_markets_project_idx` ON `project_markets` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_sites` (
	`project_id` text PRIMARY KEY NOT NULL,
	`domain` text,
	`business_group` text,
	`brand` text,
	`site_role` text DEFAULT 'other' NOT NULL,
	`ops_status` text DEFAULT 'pending' NOT NULL,
	`github_repo` text,
	`production_branch` text,
	`hosting` text DEFAULT 'unknown' NOT NULL,
	`coolify_app_uuid` text,
	`coolify_server` text,
	`auto_deploy` integer,
	`template_family` text,
	`content_format` text DEFAULT 'unknown' NOT NULL,
	`plausible_site` text,
	`gsc_property` text,
	`notes` text,
	`imported_at` text,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
