CREATE TABLE `author_workspaces` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`cache_namespace` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `author_workspaces_cache_namespace_unique` ON `author_workspaces` (`cache_namespace`);--> statement-breakpoint
CREATE TABLE `inference_usage` (
	`tenant_id` text NOT NULL,
	`usage_day` text NOT NULL,
	`request_count` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `usage_day`)
);
--> statement-breakpoint
CREATE TABLE `published_snapshots_v2` (
	`slug` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `workspace_mutations` (
	`tenant_id` text NOT NULL,
	`mutation_id` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `mutation_id`)
);
