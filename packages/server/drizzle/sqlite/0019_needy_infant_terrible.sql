ALTER TABLE `runs` ADD `duration_ms` integer;
--> statement-breakpoint
UPDATE runs SET duration_ms = CAST(json_extract(stats_json, '$.durationMs') AS INTEGER) WHERE stats_json IS NOT NULL;