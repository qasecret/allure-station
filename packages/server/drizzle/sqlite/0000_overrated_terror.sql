CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`report_name` text NOT NULL,
	`created_at` text NOT NULL,
	`finished_at` text,
	`stats_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
