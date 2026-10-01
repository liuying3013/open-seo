CREATE TABLE `content_asset_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`version_id` text NOT NULL,
	`patch_id` text,
	`decision` text NOT NULL,
	`comment` text,
	`publish_at` text,
	`decided_by_user_id` text NOT NULL,
	`decided_at` text NOT NULL,
	`revoked_at` text,
	`revoked_by_user_id` text,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `content_asset_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_asset_approvals_asset_idx` ON `content_asset_approvals` (`asset_id`);--> statement-breakpoint
CREATE TABLE `content_asset_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`version_id` text,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `content_asset_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_asset_comments_asset_idx` ON `content_asset_comments` (`asset_id`);--> statement-breakpoint
CREATE TABLE `content_asset_version_files` (
	`version_id` text NOT NULL,
	`path` text NOT NULL,
	`change` text NOT NULL,
	PRIMARY KEY(`version_id`, `path`),
	FOREIGN KEY (`version_id`) REFERENCES `content_asset_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `content_asset_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`version` integer NOT NULL,
	`draft` text NOT NULL,
	`task_branch` text,
	`base_commit` text,
	`head_commit` text,
	`patch_id` text,
	`diff_text` text,
	`checks_report` text NOT NULL,
	`qa_report` text,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_asset_versions_asset_version_idx` ON `content_asset_versions` (`asset_id`,`version`);--> statement-breakpoint
CREATE TABLE `publish_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`approval_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_by_user_id` text,
	`merge_commit` text,
	`coolify_deployment_uuid` text,
	`live_status_code` integer,
	`text_match` integer,
	`live_check_summary` text,
	`screenshot_desktop_key` text,
	`screenshot_mobile_key` text,
	`error_stage` text,
	`error_message` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_id`) REFERENCES `content_asset_approvals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `publish_attempts_asset_idx` ON `publish_attempts` (`asset_id`);--> statement-breakpoint
CREATE INDEX `publish_attempts_status_idx` ON `publish_attempts` (`status`);--> statement-breakpoint
CREATE TABLE `site_change_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`commit_sha` text NOT NULL,
	`author` text,
	`message` text,
	`detected_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by_user_id` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_change_alerts_project_commit_idx` ON `site_change_alerts` (`project_id`,`commit_sha`);--> statement-breakpoint
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
ALTER TABLE `clusters` ADD `action_reason` text;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `language` text;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `page_action` text;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `site_page_id` text REFERENCES site_pages(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `current_version` integer DEFAULT 0 NOT NULL;