CREATE TABLE `candidate_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`location_code` integer DEFAULT 2840 NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`source` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_keywords_unique_project_keyword_location_language` ON `candidate_keywords` (`project_id`,`keyword`,`location_code`,`language_code`);--> statement-breakpoint
CREATE INDEX `candidate_keywords_project_created_idx` ON `candidate_keywords` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `saved_keywords` ADD `source` text;