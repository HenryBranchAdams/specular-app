CREATE TABLE `inference_daily_usage` (
	`usage_day` text PRIMARY KEY NOT NULL,
	`global_count` integer NOT NULL,
	`tenant_counts` text NOT NULL
);
--> statement-breakpoint
DROP TABLE `inference_usage`;