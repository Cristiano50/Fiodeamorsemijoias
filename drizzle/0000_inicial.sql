CREATE TABLE `arquivos` (
	`id` text PRIMARY KEY NOT NULL,
	`pedido_id` text,
	`nome` text NOT NULL,
	`mime` text NOT NULL,
	`dados` blob NOT NULL,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `configuracoes` (
	`chave` text PRIMARY KEY NOT NULL,
	`valor` text NOT NULL,
	`atualizado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `imagens` (
	`id` text PRIMARY KEY NOT NULL,
	`produto_id` text,
	`pedido_id` text,
	`origem` text NOT NULL,
	`mime` text NOT NULL,
	`largura` integer,
	`altura` integer,
	`dados` blob NOT NULL,
	`meta` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `imagens_produto_idx` ON `imagens` (`produto_id`);--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`mensagem` text NOT NULL,
	`dados` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paginas` (
	`id` text PRIMARY KEY NOT NULL,
	`pedido_id` text NOT NULL,
	`ordem` integer NOT NULL,
	`imagem_id` text NOT NULL,
	`texto` text,
	`processada` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pedidos` (
	`id` text PRIMARY KEY NOT NULL,
	`numero` text,
	`fornecedor` text,
	`data_compra` text,
	`moeda` text DEFAULT 'CNY' NOT NULL,
	`cotacao` real DEFAULT 1 NOT NULL,
	`cotacao_fonte` text,
	`cotacao_data` text,
	`cenario` text,
	`custos` text,
	`rateio` text DEFAULT 'valor' NOT NULL,
	`total_documento` real,
	`cabecalho` text,
	`colunas` text,
	`observacoes` text,
	`status` text DEFAULT 'extraido' NOT NULL,
	`parecer` text,
	`arquivo_nome` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `produtos` (
	`id` text PRIMARY KEY NOT NULL,
	`pedido_id` text,
	`linha` integer,
	`codigo_fornecedor` text,
	`texto_original` text,
	`descricao_original` text,
	`traducao` text,
	`nome` text,
	`nome_comercial` text,
	`nomes_sugeridos` text,
	`avaliacao` text,
	`legenda` text,
	`hashtags` text,
	`destaque` integer DEFAULT false NOT NULL,
	`tipo` text,
	`subtipo` text,
	`material` text,
	`banho` text,
	`cor_pedra` text,
	`tamanho` text,
	`variacao` text,
	`grupo` text,
	`eh_conjunto` integer DEFAULT false NOT NULL,
	`componentes` text,
	`estilo` text,
	`quantidade` integer DEFAULT 1 NOT NULL,
	`preco_origem` real,
	`moeda` text DEFAULT 'CNY' NOT NULL,
	`custo_produto_brl` real,
	`custo_adicional_brl` real,
	`custo_total_brl` real,
	`fator` real,
	`preco_manual` real,
	`fator_aplicado` real,
	`preco_venda` real,
	`precos` text,
	`referencia` text,
	`codigo_barras` text,
	`ncm` text,
	`unidade` text DEFAULT 'UN' NOT NULL,
	`imagem_id` text,
	`status` text DEFAULT 'rascunho' NOT NULL,
	`confianca` real,
	`alertas` text,
	`up_id` text,
	`up_status` text,
	`up_mensagem` text,
	`up_sincronizado_em` text,
	`criado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`atualizado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `produtos_pedido_idx` ON `produtos` (`pedido_id`);--> statement-breakpoint
CREATE INDEX `produtos_referencia_idx` ON `produtos` (`referencia`);--> statement-breakpoint
CREATE UNIQUE INDEX `produtos_codigo_barras_uq` ON `produtos` (`codigo_barras`);--> statement-breakpoint
CREATE TABLE `sequencias` (
	`nome` text PRIMARY KEY NOT NULL,
	`valor` integer DEFAULT 0 NOT NULL
);
