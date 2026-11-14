import { sqliteTable, text, integer, real, blob, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const agora = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/** Pedido de compra / catálogo importado (PDF ou fotos). */
export const pedidos = sqliteTable("pedidos", {
  id: text("id").primaryKey(),
  numero: text("numero"),
  fornecedor: text("fornecedor"),
  dataCompra: text("data_compra"), // AAAA-MM-DD
  moeda: text("moeda").notNull().default("CNY"), // CNY | BRL | USD
  cotacao: real("cotacao").notNull().default(1), // R$ por 1 unidade da moeda
  cotacaoFonte: text("cotacao_fonte"),
  cotacaoData: text("cotacao_data"),
  cenario: text("cenario"), // cenário de importação (fiscal.json → custo_aquisicao.cenarios_importacao)
  custos: text("custos", { mode: "json" }).$type<Record<string, number>>(), // valores dos componentes de custo
  rateio: text("rateio").notNull().default("valor"), // valor | peca
  fator: real("fator"), // fator multiplicador escolhido pelo funcionário para o pedido (vazio = padrão)
  totalDocumento: real("total_documento"),
  cabecalho: text("cabecalho"), // texto do cabeçalho do documento
  colunas: text("colunas"), // cabeçalho da tabela (ex: 序 条码 图片 货名 ...)
  observacoes: text("observacoes"),
  status: text("status").notNull().default("extraido"), // extraido | analisado | concluido
  parecer: text("parecer", { mode: "json" }).$type<Record<string, unknown>>(),
  arquivoNome: text("arquivo_nome"),
  criadoEm: text("criado_em").notNull().default(agora),
});

/** Páginas/fotos sem tabela de texto, aguardando detecção das peças pela IA. */
export const paginas = sqliteTable("paginas", {
  id: text("id").primaryKey(),
  pedidoId: text("pedido_id").notNull(),
  ordem: integer("ordem").notNull(),
  imagemId: text("imagem_id").notNull(),
  texto: text("texto"),
  processada: integer("processada", { mode: "boolean" }).notNull().default(false),
});

export const produtos = sqliteTable(
  "produtos",
  {
    id: text("id").primaryKey(),
    pedidoId: text("pedido_id"),
    linha: integer("linha"),
    codigoFornecedor: text("codigo_fornecedor"),
    textoOriginal: text("texto_original"), // linha do documento como foi extraída
    descricaoOriginal: text("descricao_original"),
    traducao: text("traducao"),
    nome: text("nome"),
    nomeComercial: text("nome_comercial"),
    nomesSugeridos: text("nomes_sugeridos", { mode: "json" }).$type<string[]>(),
    avaliacao: text("avaliacao"),
    legenda: text("legenda"),
    hashtags: text("hashtags", { mode: "json" }).$type<string[]>(),
    destaque: integer("destaque", { mode: "boolean" }).notNull().default(false),
    tipo: text("tipo"),
    subtipo: text("subtipo"),
    material: text("material"),
    banho: text("banho"),
    corPedra: text("cor_pedra", { mode: "json" }).$type<string[]>(),
    tamanho: text("tamanho"),
    variacao: text("variacao"),
    grupo: text("grupo"), // variações do mesmo modelo (mesmo grupo = mesma referência, um EAN por variação)
    ehConjunto: integer("eh_conjunto", { mode: "boolean" }).notNull().default(false),
    componentes: text("componentes", { mode: "json" }).$type<string[]>(),
    estilo: text("estilo"),
    quantidade: integer("quantidade").notNull().default(1),
    precoOrigem: real("preco_origem"), // preço unitário na moeda do pedido
    moeda: text("moeda").notNull().default("CNY"),
    custoProdutoBrl: real("custo_produto_brl"), // preço × cotação
    custoAdicionalBrl: real("custo_adicional_brl"), // rateio frete/impostos/taxas
    custoTotalBrl: real("custo_total_brl"),
    fator: real("fator"), // override manual do fator multiplicador
    precoManual: real("preco_manual"), // preço de venda fixado manualmente (vence o fator)
    fatorAplicado: real("fator_aplicado"),
    precoVenda: real("preco_venda"), // tabela base (CONSIGNADO)
    precos: text("precos", { mode: "json" }).$type<Record<string, number>>(),
    referencia: text("referencia"),
    codigoBarras: text("codigo_barras"),
    ncm: text("ncm"),
    unidade: text("unidade").notNull().default("UN"),
    imagemId: text("imagem_id"),
    status: text("status").notNull().default("rascunho"), // rascunho | revisado | aprovado
    confianca: real("confianca"),
    alertas: text("alertas", { mode: "json" }).$type<string[]>(),
    upId: text("up_id"),
    upStatus: text("up_status"), // pendente | enviado | erro
    upMensagem: text("up_mensagem"),
    upSincronizadoEm: text("up_sincronizado_em"),
    criadoEm: text("criado_em").notNull().default(agora),
    atualizadoEm: text("atualizado_em").notNull().default(agora),
  },
  (t) => [
    index("produtos_pedido_idx").on(t.pedidoId),
    index("produtos_referencia_idx").on(t.referencia),
    uniqueIndex("produtos_codigo_barras_uq").on(t.codigoBarras),
  ],
);

export const imagens = sqliteTable(
  "imagens",
  {
    id: text("id").primaryKey(),
    produtoId: text("produto_id"),
    pedidoId: text("pedido_id"),
    origem: text("origem").notNull(), // catalogo | pagina | arte | ia | upload
    mime: text("mime").notNull(),
    largura: integer("largura"),
    altura: integer("altura"),
    dados: blob("dados", { mode: "buffer" }).notNull(),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
    criadoEm: text("criado_em").notNull().default(agora),
  },
  (t) => [index("imagens_produto_idx").on(t.produtoId)],
);

export const arquivos = sqliteTable("arquivos", {
  id: text("id").primaryKey(),
  pedidoId: text("pedido_id"),
  nome: text("nome").notNull(),
  mime: text("mime").notNull(),
  dados: blob("dados", { mode: "buffer" }).notNull(),
  criadoEm: text("criado_em").notNull().default(agora),
});

/** Sobrescritas das configurações padrão (src/config/*.json) e credenciais de integrações. */
export const configuracoes = sqliteTable("configuracoes", {
  chave: text("chave").primaryKey(),
  valor: text("valor", { mode: "json" }).notNull(),
  atualizadoEm: text("atualizado_em").notNull().default(agora),
});

export const sequencias = sqliteTable("sequencias", {
  nome: text("nome").primaryKey(),
  valor: integer("valor").notNull().default(0),
});

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tipo: text("tipo").notNull(),
  mensagem: text("mensagem").notNull(),
  dados: text("dados", { mode: "json" }),
  criadoEm: text("criado_em").notNull().default(agora),
});

export type Pedido = typeof pedidos.$inferSelect;
export type Produto = typeof produtos.$inferSelect;
export type NovoProduto = typeof produtos.$inferInsert;
export type Imagem = typeof imagens.$inferSelect;
