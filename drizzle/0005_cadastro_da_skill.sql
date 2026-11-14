ALTER TABLE `pedidos` ADD `cadastro_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `pedidos_cadastro_id_unique` ON `pedidos` (`cadastro_id`);