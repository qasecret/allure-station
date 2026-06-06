CREATE TABLE IF NOT EXISTS "test_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"history_id" text,
	"name" text NOT NULL,
	"full_name" text,
	"status" text NOT NULL,
	"duration" text,
	"flaky" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_test_results_run" ON "test_results" USING btree ("run_id");