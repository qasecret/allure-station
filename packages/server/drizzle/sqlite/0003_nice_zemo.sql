CREATE TABLE `test_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`history_id` text,
	`name` text NOT NULL,
	`full_name` text,
	`status` text NOT NULL,
	`duration` text,
	`flaky` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_test_results_run` ON `test_results` (`run_id`);