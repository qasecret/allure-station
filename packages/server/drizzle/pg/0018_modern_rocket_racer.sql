ALTER TABLE "runs" ADD COLUMN "duration_ms" integer;
--> statement-breakpoint
UPDATE runs SET duration_ms = NULLIF((stats_json::jsonb ->> 'durationMs'), '')::bigint WHERE stats_json IS NOT NULL;