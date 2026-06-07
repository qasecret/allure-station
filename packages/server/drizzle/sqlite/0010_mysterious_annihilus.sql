ALTER TABLE `runs` ADD `branch` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `commit` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `environment` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `ci_url` text;--> statement-breakpoint
CREATE INDEX `idx_runs_project_branch` ON `runs` (`project_id`,`branch`);