CREATE TABLE `site_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`path` text NOT NULL,
	`language` text,
	`route_file` text,
	`content_file` text,
	`title` text,
	`meta_description` text,
	`h1` text,
	`canonical` text,
	`noindex` integer DEFAULT false NOT NULL,
	`status_code` integer,
	`page_role` text,
	`in_sitemap` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`last_checked_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_pages_project_url_idx` ON `site_pages` (`project_id`,`url`);--> statement-breakpoint
CREATE INDEX `site_pages_project_language_idx` ON `site_pages` (`project_id`,`language`);--> statement-breakpoint
CREATE TABLE `page_plan_items` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`cluster_id` text,
	`action` text NOT NULL,
	`target_url` text NOT NULL,
	`site_page_id` text,
	`language` text,
	`score` real,
	`score_reasons` text,
	`confidence` real,
	`est_cost_usd` real,
	`included` integer DEFAULT true NOT NULL,
	`asset_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `page_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`site_page_id`) REFERENCES `site_pages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `page_plan_items_plan_idx` ON `page_plan_items` (`plan_id`);--> statement-breakpoint
CREATE TABLE `page_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`approved_by_user_id` text,
	`approved_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_plans_project_period_idx` ON `page_plans` (`project_id`,`period`);--> statement-breakpoint
ALTER TABLE `clusters` ADD `target_page_id` text REFERENCES site_pages(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `clusters` ADD `target_url` text;--> statement-breakpoint
ALTER TABLE `clusters` ADD `planned_action` text;--> statement-breakpoint
ALTER TABLE `clusters` ADD `action_reason` text;