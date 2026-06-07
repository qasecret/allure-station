CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`actor_label` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`project_id` text,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `idx_audit_project_at` ON `audit_log` (`project_id`,`at`);