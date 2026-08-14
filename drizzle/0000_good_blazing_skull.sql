CREATE TABLE `published_snapshots` (
	`slug` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
