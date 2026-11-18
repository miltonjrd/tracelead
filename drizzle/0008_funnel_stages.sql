CREATE TABLE `funnel_stages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `funnel_stages_client_pos_idx` ON `funnel_stages` (`client_id`,`position`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `stage_id` integer REFERENCES funnel_stages(id) ON UPDATE no action ON DELETE set null;