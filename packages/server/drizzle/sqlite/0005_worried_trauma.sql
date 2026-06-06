DROP INDEX IF EXISTS `idx_api_tokens_hash`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_tokens_hash` ON `api_tokens` (`token_hash`);