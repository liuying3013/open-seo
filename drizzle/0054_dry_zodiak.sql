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
ALTER TABLE `content_assets` ADD `language` text;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `page_action` text;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `site_page_id` text;--> statement-breakpoint
ALTER TABLE `content_assets` ADD `current_version` integer DEFAULT 0 NOT NULL;