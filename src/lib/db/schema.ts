import { sqliteTable, text, integer, real, blob, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";
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
  // Id do cadastro feito na skill do Claude (o app não importa o mesmo cadastro duas vezes).
  cadastroId: text("cadastro_id").unique(),
  // Chegada e conferência da mercadoria (giro, "parado" e "novidade" contam da chegada).
  dataChegada: text("data_chegada"), // AAAA-MM-DD
  recebimento: text("recebimento"), // em_transito | recebido | conferido (vazio = não informado)
  conferidoEm: text("conferido_em"),
  conferidoPor: text("conferido_por"),
  // Pagamento ao fornecedor e custo verdadeiro.
  pagoEm: text("pago_em"), // AAAA-MM-DD
  valorPagoBrl: real("valor_pago_brl"), // R$ efetivamente pagos pela mercadoria (cartão/agente)
  cotacaoPtax: real("cotacao_ptax"), // PTAX guardada quando a cotação efetiva substitui a PTAX
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
    // Especificação/cor do fornecedor como veio no documento (G, MR, 金色, 玫瑰金, 16…); chave da recompra.
    especificacao: text("especificacao"),
    // Recompra a confirmar: originais possíveis quando a peça casa com mais de um (cor/tamanho ambíguo).
    recompraCandidatas: text("recompra_candidatas", { mode: "json" }).$type<string[]>(),
    grupo: text("grupo"), // variações do mesmo modelo (mesmo grupo = mesma referência, um EAN por variação)
    recompraDe: text("recompra_de"), // produto original quando a linha é recompra (mesma referência e EAN)
    ehConjunto: integer("eh_conjunto", { mode: "boolean" }).notNull().default(false),
    componentes: text("componentes", { mode: "json" }).$type<string[]>(),
    estilo: text("estilo"),
    quantidade: integer("quantidade").notNull().default(1), // quantidade pedida
    // Conferência de recebimento (vazio = ainda não conferido: vale a quantidade pedida).
    quantidadeRecebida: integer("quantidade_recebida"),
    quantidadeDefeito: integer("quantidade_defeito").notNull().default(0),
    defeitoImagemId: text("defeito_imagem_id"),
    defeitoObs: text("defeito_obs"),
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
    // De onde veio o código de barras: "up" = criado pelo UP Vendas (importado ou bipado); "app" = EAN interno gerado pelo app.
    codigoBarrasOrigem: text("codigo_barras_origem"),
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
    index("produtos_codigo_barras_idx").on(t.codigoBarras), // recompra reaproveita o EAN do produto original
    index("produtos_codigo_fornecedor_idx").on(t.codigoFornecedor),
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

/** Usuários do app (gestora, funcionário). Sem usuários cadastrados, vale APP_SENHA ou o acesso livre local. */
export const usuarios = sqliteTable(
  "usuarios",
  {
    id: text("id").primaryKey(),
    nome: text("nome").notNull(),
    login: text("login").notNull(),
    senhaHash: text("senha_hash").notNull(),
    papel: text("papel").notNull().default("funcionario"), // gestora | funcionario
    ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
    // Sobe ao desativar, trocar senha/papel ou sair: derruba as sessões antigas.
    versaoSessao: integer("versao_sessao").notNull().default(1),
    criadoEm: text("criado_em").notNull().default(agora),
  },
  (t) => [uniqueIndex("usuarios_login_uq").on(t.login)],
);

/** Histórico de alterações: quem mudou o quê. */
export const historico = sqliteTable(
  "historico",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    criadoEm: text("criado_em").notNull().default(agora),
    usuarioId: text("usuario_id"),
    usuarioNome: text("usuario_nome"),
    acao: text("acao").notNull(), // ex.: pedido.fator, produto.preco, produto.excluir, config.precificacao
    entidade: text("entidade"),
    entidadeId: text("entidade_id"),
    resumo: text("resumo").notNull(),
    dados: text("dados", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("historico_entidade_idx").on(t.entidade, t.entidadeId)],
);

/** Gastos com IA (Claude, Gemini, OpenAI), para o painel e o limite mensal. */
export const gastosIa = sqliteTable(
  "gastos_ia",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    criadoEm: text("criado_em").notNull().default(agora),
    servico: text("servico").notNull(), // anthropic | gemini | openai
    modelo: text("modelo").notNull(),
    finalidade: text("finalidade").notNull(), // analise | deteccao | parecer | textos | foto | avaliacao_foto
    pedidoId: text("pedido_id"),
    produtoId: text("produto_id"),
    tokensEntrada: integer("tokens_entrada").notNull().default(0),
    tokensSaida: integer("tokens_saida").notNull().default(0),
    imagens: integer("imagens").notNull().default(0),
    custoUsd: real("custo_usd").notNull().default(0),
  },
  (t) => [index("gastos_ia_data_idx").on(t.criadoEm)],
);

/** Vendas importadas do UP Vendas (planilha hoje; API quando disponível). */
export const vendas = sqliteTable(
  "vendas",
  {
    id: text("id").primaryKey(),
    loteId: text("lote_id"),
    data: text("data"), // AAAA-MM-DD
    referencia: text("referencia"),
    codigoBarras: text("codigo_barras"),
    produtoId: text("produto_id"), // ligado pelo EAN ou pela referência
    descricao: text("descricao"),
    quantidade: real("quantidade").notNull().default(1),
    valorTotal: real("valor_total"),
    revendedora: text("revendedora"),
    canal: text("canal"), // consignado | varejo | ...
    origem: text("origem").notNull().default("planilha"),
    criadoEm: text("criado_em").notNull().default(agora),
  },
  (t) => [index("vendas_produto_idx").on(t.produtoId), index("vendas_data_idx").on(t.data), index("vendas_revendedora_idx").on(t.revendedora)],
);

export const lotesVendas = sqliteTable("lotes_vendas", {
  id: text("id").primaryKey(),
  arquivoNome: text("arquivo_nome"),
  linhas: integer("linhas").notNull().default(0),
  ligadas: integer("ligadas").notNull().default(0), // linhas ligadas a produtos do app
  periodoInicio: text("periodo_inicio"),
  periodoFim: text("periodo_fim"),
  criadoEm: text("criado_em").notNull().default(agora),
});

/**
 * Apelido do fornecedor (nome de exibição escolhido pela loja).
 * O nome original do documento (ex.: em chinês) continua em pedidos.fornecedor e é ele que a recompra usa.
 * chave = nome original sem espaços e em minúsculas (a mesma regra da recompra).
 */
export const fornecedores = sqliteTable("fornecedores", {
  chave: text("chave").primaryKey(),
  nomeOriginal: text("nome_original").notNull(),
  apelido: text("apelido"),
  loteMinimo: integer("lote_minimo"), // múltiplo que o fornecedor aceita na recompra (vazio = padrão)
  atualizadoEm: text("atualizado_em").notNull().default(agora),
});

/** Cotações já buscadas (PTAX etc.), para não ir ao Banco Central a cada tela. */
export const cotacoes = sqliteTable(
  "cotacoes",
  {
    moeda: text("moeda").notNull(),
    data: text("data").notNull(), // data pedida (AAAA-MM-DD)
    tipo: text("tipo").notNull(), // venda | compra
    cotacao: real("cotacao").notNull(),
    dataEfetiva: text("data_efetiva"), // dia útil de onde veio a cotação
    fonte: text("fonte"),
    criadoEm: text("criado_em").notNull().default(agora),
  },
  (t) => [primaryKey({ columns: [t.moeda, t.data, t.tipo] })],
);

/** Créditos com o fornecedor (falta, defeito, troca) para abater no próximo pedido. */
export const creditosFornecedor = sqliteTable(
  "creditos_fornecedor",
  {
    id: text("id").primaryKey(),
    fornecedorChave: text("fornecedor_chave").notNull(), // chaveFornecedor(nome original)
    fornecedor: text("fornecedor"), // nome original
    pedidoId: text("pedido_id"), // pedido onde surgiu
    produtoId: text("produto_id"),
    descricao: text("descricao").notNull(),
    quantidade: integer("quantidade").notNull().default(0),
    valorMoeda: real("valor_moeda").notNull().default(0), // na moeda do pedido
    moeda: text("moeda").notNull().default("CNY"),
    status: text("status").notNull().default("aberto"), // aberto | abatido | cancelado
    abatidoPedidoId: text("abatido_pedido_id"),
    criadoEm: text("criado_em").notNull().default(agora),
    atualizadoEm: text("atualizado_em").notNull().default(agora),
  },
  (t) => [index("creditos_fornecedor_idx").on(t.fornecedorChave), index("creditos_pedido_idx").on(t.pedidoId)],
);

/** Saldo de estoque informado pelo UP Vendas (lido da lista de produtos exportada), por código de barras. */
export const saldosUp = sqliteTable("saldos_up", {
  codigoBarras: text("codigo_barras").primaryKey(),
  saldo: integer("saldo").notNull(),
  arquivo: text("arquivo"),
  atualizadoEm: text("atualizado_em").notNull().default(agora),
});

/** Planilhas de consignado (maletas) importadas do UP. */
export const lotesConsignado = sqliteTable("lotes_consignado", {
  id: text("id").primaryKey(),
  arquivoNome: text("arquivo_nome"),
  linhas: integer("linhas").notNull().default(0),
  criadoEm: text("criado_em").notNull().default(agora),
});

/** Peças em maletas: com a revendedora, devolvidas, vendidas, avariadas ou perdidas. */
export const consignado = sqliteTable(
  "consignado",
  {
    id: text("id").primaryKey(),
    loteId: text("lote_id").notNull(),
    data: text("data"), // AAAA-MM-DD
    revendedora: text("revendedora"),
    codigoBarras: text("codigo_barras"),
    referencia: text("referencia"),
    produtoId: text("produto_id"),
    descricao: text("descricao"),
    quantidade: integer("quantidade").notNull().default(1),
    situacao: text("situacao").notNull().default("com_revendedora"), // com_revendedora | devolvida | vendida | avariada | perdida
    criadoEm: text("criado_em").notNull().default(agora),
  },
  (t) => [index("consignado_lote_idx").on(t.loteId), index("consignado_revendedora_idx").on(t.revendedora), index("consignado_produto_idx").on(t.produtoId)],
);

/** Tentativas de login com falha (limite por IP e por login). */
export const tentativasLogin = sqliteTable("tentativas_login", {
  chave: text("chave").primaryKey(), // "ip:1.2.3.4" ou "login:ana"
  falhas: integer("falhas").notNull().default(0),
  bloqueadoAte: text("bloqueado_ate"),
  atualizadoEm: text("atualizado_em").notNull().default(agora),
});

export type Pedido = typeof pedidos.$inferSelect;
export type Produto = typeof produtos.$inferSelect;
export type NovoProduto = typeof produtos.$inferInsert;
export type Imagem = typeof imagens.$inferSelect;
export type Usuario = typeof usuarios.$inferSelect;
export type Venda = typeof vendas.$inferSelect;
