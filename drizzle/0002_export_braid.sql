PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_exports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`referencia_id` integer NOT NULL,
	`arquivo` text NOT NULL,
	`gclid` text,
	`gbraid` text,
	`wbraid` text,
	`conversao_em` integer NOT NULL,
	`valor_centavos` integer,
	`status` text DEFAULT 'gerado' NOT NULL,
	`exportado_em` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_exports`("id", "client_id", "tipo", "referencia_id", "arquivo", "gclid", "gbraid", "wbraid", "conversao_em", "valor_centavos", "status", "exportado_em") SELECT "id", "client_id", "tipo", "referencia_id", "arquivo", "gclid", NULL, NULL, "conversao_em", "valor_centavos", "status", "exportado_em" FROM `exports`;--> statement-breakpoint
DROP TABLE `exports`;--> statement-breakpoint
ALTER TABLE `__new_exports` RENAME TO `exports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `exports_client_arquivo_idx` ON `exports` (`client_id`,`arquivo`);