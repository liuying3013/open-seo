CREATE TABLE `cluster_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_id` text NOT NULL,
	`candidate_keyword_id` text NOT NULL,
	`is_representative` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_keyword_id`) REFERENCES `candidate_keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cluster_keywords_candidate_keyword_idx` ON `cluster_keywords` (`candidate_keyword_id`);--> statement-breakpoint
CREATE INDEX `cluster_keywords_cluster_idx` ON `cluster_keywords` (`cluster_id`);--> statement-breakpoint
CREATE TABLE `clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`offer_id` text,
	`name` text NOT NULL,
	`primary_entity` text,
	`entity_category` text,
	`user_job` text,
	`status` text DEFAULT 'new' NOT NULL,
	`status_changed_at` text,
	`intent_vector` text,
	`serp_format_scores` text,
	`platform_acceptance` text,
	`business_value_score` real,
	`business_value_breakdown` text,
	`scored_at` text,
	`rule_version` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offer_id`) REFERENCES `offers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `clusters_project_status_idx` ON `clusters` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `content_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text NOT NULL,
	`decision_id` text,
	`platform` text NOT NULL,
	`asset_type` text,
	`angle` text,
	`title` text,
	`brief` text,
	`brand_mention_mode` text,
	`draft` text,
	`qa_report` text,
	`target_url` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`published_url` text,
	`published_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decision_id`) REFERENCES `deployment_decisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `content_assets_cluster_idx` ON `content_assets` (`cluster_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `content_assets_decision_platform_idx` ON `content_assets` (`decision_id`,`platform`);--> statement-breakpoint
CREATE INDEX `content_assets_project_status_idx` ON `content_assets` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `content_budgets` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`serp_fetches` integer DEFAULT 0 NOT NULL,
	`llm_calls` integer DEFAULT 0 NOT NULL,
	`briefs_generated` integer DEFAULT 0 NOT NULL,
	`page_reads` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decision_log` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text,
	`decision_type` text NOT NULL,
	`input_snapshot` text,
	`decision` text NOT NULL,
	`reason_summary` text,
	`model` text,
	`prompt_version` text,
	`rule_version` text,
	`confidence` real,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `decision_log_project_created_idx` ON `decision_log` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `decision_log_cluster_idx` ON `decision_log` (`cluster_id`);--> statement-breakpoint
CREATE TABLE `deployment_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`money_site_page_type` text,
	`platform_plan` text,
	`reason_summary` text,
	`decided_by` text NOT NULL,
	`approved_at` text,
	`superseded_by_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployment_decisions_cluster_idx` ON `deployment_decisions` (`cluster_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `deployment_decisions_one_proposed_per_cluster_idx` ON `deployment_decisions` (`cluster_id`) WHERE "deployment_decisions"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX `deployment_decisions_project_status_idx` ON `deployment_decisions` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `evidence_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_packs_cluster_version_idx` ON `evidence_packs` (`cluster_id`,`version`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`margin_tier` text NOT NULL,
	`readiness` text NOT NULL,
	`market_priority` integer DEFAULT 3 NOT NULL,
	`conversion_assets` text,
	`notes` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offers_project_idx` ON `offers` (`project_id`);--> statement-breakpoint
CREATE TABLE `serp_results` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`rank` integer NOT NULL,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`title` text,
	`description` text,
	`result_type` text NOT NULL,
	`platform` text,
	`content_type` text,
	`is_owned` integer DEFAULT false NOT NULL,
	`is_competitor` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `serp_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `serp_results_snapshot_rank_idx` ON `serp_results` (`snapshot_id`,`rank`);--> statement-breakpoint
CREATE TABLE `serp_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text,
	`keyword` text NOT NULL,
	`location_code` integer NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`device` text DEFAULT 'desktop' NOT NULL,
	`fetched_at` text DEFAULT (current_timestamp) NOT NULL,
	`result_count` integer,
	`serp_features` text,
	`r2_key` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `serp_snapshots_project_keyword_fetched_idx` ON `serp_snapshots` (`project_id`,`keyword`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `serp_snapshots_cluster_idx` ON `serp_snapshots` (`cluster_id`);