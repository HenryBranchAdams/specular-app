ALTER TABLE `inference_daily_usage` ADD `last_reservation_id` text;--> statement-breakpoint
ALTER TABLE `inference_daily_usage` ADD `last_reservation_accepted` integer DEFAULT 0 NOT NULL;