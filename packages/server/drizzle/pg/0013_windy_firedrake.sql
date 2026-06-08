DROP INDEX IF EXISTS "idx_test_results_history";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_test_results_fullname";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_test_results_history" ON "test_results" USING btree ("history_id","run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_test_results_fullname" ON "test_results" USING btree ("full_name","run_id");