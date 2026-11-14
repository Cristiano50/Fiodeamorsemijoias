CREATE TABLE `gastos_ia` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`servico` text NOT NULL,
	`modelo` text NOT NULL,
	`finalidade` text NOT NULL,
	`pedido_id` text,
	`produto_id` text,
	`tokens_entrada` integer DEFAULT 0 NOT NULL,
	`tokens_saida` integer DEFAULT 0 NOT NULL,
	`imagens` integer DEFAULT 0 NOT NULL,
	`custo_usd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gastos_ia_data_idx` ON `gastos_ia` (`criado_em`);--> statement-breakpoint
CREATE TABLE `historico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`usuario_id` text,
	`usuario_nome` text,
	`acao` text NOT NULL,
	`entidade` text,
	`entidade_id` text,
	`resumo` text NOT NULL,
	`dados` text
);
--> statement-breakpoint
CREATE INDEX `historico_entidade_idx` ON `historico` (`entidade`,`entidade_id`);--> statement-breakpoint
CREATE TABLE `lotes_vendas` (
	`id` text PRIMARY KEY NOT NULL,
	`arquivo_nome` text,
	`linhas` integer DEFAULT 0 NOT NULL,
	`ligadas` integer DEFAULT 0 NOT NULL,
	`periodo_inicio` text,
	`periodo_fim` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` text PRIMARY KEY NOT NULL,
	`nome` text NOT NULL,
	`login` text NOT NULL,
	`senha_hash` text NOT NULL,
	`papel` text DEFAULT 'funcionario' NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_login_uq` ON `usuarios` (`login`);--> statement-breakpoint
CREATE TABLE `vendas` (
	`id` text PRIMARY KEY NOT NULL,
	`lote_id` text,
	`data` text,
	`referencia` text,
	`codigo_barras` text,
	`produto_id` text,
	`descricao` text,
	`quantidade` real DEFAULT 1 NOT NULL,
	`valor_total` real,
	`revendedora` text,
	`canal` text,
	`origem` text DEFAULT 'planilha' NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `vendas_produto_idx` ON `vendas` (`produto_id`);--> statement-breakpoint
CREATE INDEX `vendas_data_idx` ON `vendas` (`data`);--> statement-breakpoint
CREATE INDEX `vendas_revendedora_idx` ON `vendas` (`revendedora`);--> statement-breakpoint
DROP INDEX `produtos_codigo_barras_uq`;--> statement-breakpoint
ALTER TABLE `produtos` ADD `recompra_de` text;--> statement-breakpoint
CREATE INDEX `produtos_codigo_barras_idx` ON `produtos` (`codigo_barras`);--> statement-breakpoint
CREATE INDEX `produtos_codigo_fornecedor_idx` ON `produtos` (`codigo_fornecedor`);