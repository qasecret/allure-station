ALTER TABLE "runs" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "commit" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "ci_url" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_project_branch" ON "runs" USING btree ("project_id","branch");