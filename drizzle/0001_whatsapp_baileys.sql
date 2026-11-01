CREATE TABLE `whatsapp_auth` (
	`client_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`client_id`, `key`),
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `clients` ADD `whatsapp_mode` text DEFAULT 'baileys' NOT NULL;
--> statement-breakpoint
UPDATE `clients` SET `whatsapp_mode` = 'cloud' WHERE `whatsapp_phone_number_id` IS NOT NULL;
