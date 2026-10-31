CREATE TABLE `ad_spend` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`date` text NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_name` text NOT NULL,
	`cost_micros` integer NOT NULL,
	`clicks` integer NOT NULL,
	`impressions` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ad_spend_client_date_campaign_idx` ON `ad_spend` (`client_id`,`date`,`campaign_id`);--> statement-breakpoint
CREATE TABLE `clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`ref` text NOT NULL,
	`gclid` text,
	`gbraid` text,
	`wbraid` text,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	`utm_term` text,
	`utm_content` text,
	`landing_url` text,
	`user_agent` text,
	`ip_hash` text,
	`campaign_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clicks_client_ref_idx` ON `clicks` (`client_id`,`ref`);--> statement-breakpoint
CREATE INDEX `clicks_client_gclid_idx` ON `clicks` (`client_id`,`gclid`);--> statement-breakpoint
CREATE INDEX `clicks_client_created_idx` ON `clicks` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`google_ads_customer_id` text,
	`whatsapp_phone_number_id` text,
	`timezone` text DEFAULT 'America/Sao_Paulo' NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_public_key_unique` ON `clients` (`public_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_whatsapp_phone_number_id_unique` ON `clients` (`whatsapp_phone_number_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`phone` text NOT NULL,
	`name` text,
	`first_message_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`origem` text NOT NULL,
	`click_id` integer,
	`campanha` text,
	`status` text DEFAULT 'aberto' NOT NULL,
	`status_at` integer NOT NULL,
	`exportada_em` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`click_id`) REFERENCES `clicks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_client_phone_idx` ON `contacts` (`client_id`,`phone`);--> statement-breakpoint
CREATE INDEX `contacts_client_last_msg_idx` ON `contacts` (`client_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`referencia_id` integer NOT NULL,
	`arquivo` text NOT NULL,
	`gclid` text NOT NULL,
	`conversao_em` integer NOT NULL,
	`valor_centavos` integer,
	`status` text DEFAULT 'gerado' NOT NULL,
	`exportado_em` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `exports_client_arquivo_idx` ON `exports` (`client_id`,`arquivo`);--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job` text NOT NULL,
	`client_id` integer,
	`status` text NOT NULL,
	`detail` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_started_idx` ON `job_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`contact_id` integer NOT NULL,
	`valor_centavos` integer NOT NULL,
	`sold_at` integer NOT NULL,
	`marcado_por` integer,
	`exportada_em` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marcado_por`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_client_sold_idx` ON `sales` (`client_id`,`sold_at`);--> statement-breakpoint
CREATE INDEX `sales_contact_idx` ON `sales` (`contact_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`renewed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);