CREATE TABLE `fornecedores` (
	`chave` text PRIMARY KEY NOT NULL,
	`nome_original` text NOT NULL,
	`apelido` text,
	`atualizado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
