CREATE TABLE `knowledge_conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`knowledge_id` text NOT NULL,
	`conflicting_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` text,
	`resolved_by` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conflicting_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_conflicts_project_status_idx` ON `knowledge_conflicts` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `knowledge_deltas` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text,
	`asset_id` text,
	`ran_at` text DEFAULT (current_timestamp) NOT NULL,
	`added_count` integer DEFAULT 0 NOT NULL,
	`supported_count` integer DEFAULT 0 NOT NULL,
	`corrected_count` integer DEFAULT 0 NOT NULL,
	`conflict_count` integer DEFAULT 0 NOT NULL,
	`reused_only` integer DEFAULT false NOT NULL,
	`summary` text,
	`model` text,
	`prompt_version` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `knowledge_deltas_project_ran_idx` ON `knowledge_deltas` (`project_id`,`ran_at`);--> statement-breakpoint
CREATE TABLE `knowledge_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`claim_type` text NOT NULL,
	`category` text NOT NULL,
	`statement` text NOT NULL,
	`normalized_statement` text NOT NULL,
	`entity` text,
	`applicability` text,
	`numeric_value` real,
	`numeric_unit` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`scope` text DEFAULT 'internal' NOT NULL,
	`source_quality` text,
	`model_confidence` real,
	`verified_at` text,
	`verified_by` text,
	`recheck_after` text,
	`supersedes_id` text,
	`rule_version` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_entries_project_statement_idx` ON `knowledge_entries` (`project_id`,`normalized_statement`);--> statement-breakpoint
CREATE INDEX `knowledge_entries_project_status_idx` ON `knowledge_entries` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `knowledge_entries_entity_idx` ON `knowledge_entries` (`project_id`,`entity`);--> statement-breakpoint
CREATE TABLE `knowledge_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`research_page_id` text,
	`source_type` text NOT NULL,
	`url` text,
	`excerpt` text,
	`locator` text,
	`captured_at` text DEFAULT (current_timestamp) NOT NULL,
	`is_independent` integer DEFAULT true NOT NULL,
	`is_own_content` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_page_id`) REFERENCES `research_pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `knowledge_sources_knowledge_idx` ON `knowledge_sources` (`knowledge_id`);--> statement-breakpoint
CREATE TABLE `knowledge_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`knowledge_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`evidence_pack_id` text,
	`used_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `content_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_pack_id`) REFERENCES `evidence_packs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_usages_knowledge_asset_idx` ON `knowledge_usages` (`knowledge_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `knowledge_usages_asset_idx` ON `knowledge_usages` (`asset_id`);--> statement-breakpoint
CREATE TABLE `research_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cluster_id` text,
	`serp_result_id` text,
	`url` text NOT NULL,
	`domain` text NOT NULL,
	`fetched_at` text DEFAULT (current_timestamp) NOT NULL,
	`fetch_method` text NOT NULL,
	`fetch_status` text NOT NULL,
	`http_status` integer,
	`title` text,
	`body_text` text,
	`object_key` text,
	`content_hash` text,
	`word_count` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cluster_id`) REFERENCES `clusters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`serp_result_id`) REFERENCES `serp_results`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `research_pages_project_url_fetched_idx` ON `research_pages` (`project_id`,`url`,`fetched_at`);--> statement-breakpoint
CREATE INDEX `research_pages_cluster_idx` ON `research_pages` (`cluster_id`);