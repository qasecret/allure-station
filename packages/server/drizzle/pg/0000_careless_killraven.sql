CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"report_name" text NOT NULL,
	"created_at" text NOT NULL,
	"finished_at" text,
	"stats_json" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_project" ON "runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_project_status_created" ON "runs" USING btree ("project_id","status","created_at");