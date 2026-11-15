CREATE TABLE `consignado` (
	`id` text PRIMARY KEY NOT NULL,
	`lote_id` text NOT NULL,
	`data` text,
	`revendedora` text,
	`codigo_barras` text,
	`referencia` text,
	`produto_id` text,
	`descricao` text,
	`quantidade` integer DEFAULT 1 NOT NULL,
	`situacao` text DEFAULT 'com_revendedora' NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `consignado_lote_idx` ON `consignado` (`lote_id`);--> statement-breakpoint
CREATE INDEX `consignado_revendedora_idx` ON `consignado` (`revendedora`);--> statement-breakpoint
CREATE INDEX `consignado_produto_idx` ON `consignado` (`produto_id`);--> statement-breakpoint
CREATE TABLE `cotacoes` (
	`moeda` text NOT NULL,
	`data` text NOT NULL,
	`tipo` text NOT NULL,
	`cotacao` real NOT NULL,
	`data_efetiva` text,
	`fonte` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`moeda`, `data`, `tipo`)
);
--> statement-breakpoint
CREATE TABLE `creditos_fornecedor` (
	`id` text PRIMARY KEY NOT NULL,
	`fornecedor_chave` text NOT NULL,
	`fornecedor` text,
	`pedido_id` text,
	`produto_id` text,
	`descricao` text NOT NULL,
	`quantidade` integer DEFAULT 0 NOT NULL,
	`valor_moeda` real DEFAULT 0 NOT NULL,
	`moeda` text DEFAULT 'CNY' NOT NULL,
	`status` text DEFAULT 'aberto' NOT NULL,
	`abatido_pedido_id` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`atualizado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `creditos_fornecedor_idx` ON `creditos_fornecedor` (`fornecedor_chave`);--> statement-breakpoint
CREATE INDEX `creditos_pedido_idx` ON `creditos_fornecedor` (`pedido_id`);--> statement-breakpoint
CREATE TABLE `lotes_consignado` (
	`id` text PRIMARY KEY NOT NULL,
	`arquivo_nome` text,
	`linhas` integer DEFAULT 0 NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saldos_up` (
	`codigo_barras` text PRIMARY KEY NOT NULL,
	`saldo` integer NOT NULL,
	`arquivo` text,
	`atualizado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tentativas_login` (
	`chave` text PRIMARY KEY NOT NULL,
	`falhas` integer DEFAULT 0 NOT NULL,
	`bloqueado_ate` text,
	`atualizado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `fornecedores` ADD `lote_minimo` integer;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `data_chegada` text;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `recebimento` text;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `conferido_em` text;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `conferido_por` text;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `pago_em` text;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `valor_pago_brl` real;--> statement-breakpoint
ALTER TABLE `pedidos` ADD `cotacao_ptax` real;--> statement-breakpoint
ALTER TABLE `produtos` ADD `especificacao` text;--> statement-breakpoint
ALTER TABLE `produtos` ADD `recompra_candidatas` text;--> statement-breakpoint
ALTER TABLE `produtos` ADD `quantidade_recebida` integer;--> statement-breakpoint
ALTER TABLE `produtos` ADD `quantidade_defeito` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `produtos` ADD `defeito_imagem_id` text;--> statement-breakpoint
ALTER TABLE `produtos` ADD `defeito_obs` text;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `versao_sessao` integer DEFAULT 1 NOT NULL;