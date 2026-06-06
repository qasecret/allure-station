DROP INDEX IF EXISTS "idx_api_tokens_hash";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_api_tokens_hash" ON "api_tokens" USING btree ("token_hash");