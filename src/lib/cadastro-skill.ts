import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, schema } from "./db";
import { getCenarios, getComponentesCusto, getConfig, salvarConfig } from "./config";
import { usuarioDaRequisicao, SemPermissao } from "./auth";
import { buscarCotacao } from "./cambio";
import { numerarLinhasPacote, quantidadeDoPacote } from "./extracao";
import { chaveRecompra, chaveSequenciaReferencia, classificarRecompra, lerReferencia, normalizarChave } from "./codigos";
import { apelidosFornecedores, chaveFornecedor } from "./fornecedores";
import { registrar } from "./historico";
import { lerNumeroBr } from "./numeros";
import { brl, cenarioPadraoPara, custosIniciais, fatorAbaixoDoMinimo, precoManualAbaixoDoMinimo } from "./precos";
import {
  aguardandoRecompra,
  agruparVariacoesAutomaticas,
  detectarRecompras,
  especificacaoDe,
  gerarCodigos,
  novoId,
  produtosDoPedido,
  recalcularPedido,
  salvarImagem,
} from "./servicos";

/**
 * Ponte entre a skill "fiodeamor-cadastro" do Claude e o app.
 *  - contexto: o que a skill precisa para cadastrar igual ao app (regras atuais, próximas referências,
 *    produtos já cadastrados para reconhecer recompra, com a mesma chave do app);
 *  - importar: grava no app o cadastro feito no Claude (pedido, peças, fotos), em uma ou várias partes.
 * Formato: skill/fiodeamor-cadastro/referencias/formato-cadastro.md
 */

export const FORMATO = "fiodeamor-cadastro";
export const VERSAO = 1;
const QUEM_SKILL = { u: null, n: "Skill do Claude", p: null };

/** Quem importa: a skill pela chave (p = null, vale como funcionária) ou alguém logado no app. */
export interface QuemImporta {
  u: string | null;
  n: string;
  p?: "gestora" | "funcionario" | null;
}

/* ------------------------------------------------------------------ acesso */

/** Chave da skill; vazia = cria uma nova e salva. */
export async function garantirChaveSkill(nova = false): Promise<string> {
  const sistema = await getConfig("sistema");
  if (sistema.skillChave && !nova) return sistema.skillChave;
  const skillChave = `fda_${randomBytes(24).toString("base64url")}`;
  await salvarConfig("sistema", { ...sistema, skillChave });
  return skillChave;
}

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Quem está chamando: a skill (cabeçalho "Authorization: Bearer <chave>") ou alguém logado no app.
 * As rotas /api/skill/* são públicas no proxy e conferem aqui.
 */
export async function autorizarSkill(req: NextRequest): Promise<QuemImporta & { skill: boolean }> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (m) {
    const { skillChave } = await getConfig("sistema");
    if (skillChave && iguais(m[1], skillChave)) return { ...QUEM_SKILL, skill: true };
    throw new SemPermissao("Chave da skill inválida. Gere ou copie a chave em Configurações → Skill do Claude.");
  }
  const u = await usuarioDaRequisicao(req);
  if (!u) throw new SemPermissao("Faça login no app ou use a chave da skill.");
  return { u: u.u, n: u.n, p: u.p, skill: false };
}

/* ---------------------------------------------------------------- contexto */

/** Próximo número de cada prefixo de referência no mês (sem reservar). */
async function proximasReferencias() {
  const [tax, sistema] = await Promise.all([getConfig("taxonomia"), getConfig("sistema")]);
  const db = await getDb();
  const agora = new Date();
  const prefixos = [...new Set(tax.tipos.map((t) => t.prefixo).filter(Boolean) as string[]), "SJ"];
  const chaves = prefixos.map((p) => chaveSequenciaReferencia(sistema.referenciaModelo, p, agora));
  const seqs = await db.select().from(schema.sequencias).where(inArray(schema.sequencias.nome, chaves));
  const out: Record<string, number> = {};
  prefixos.forEach((p, i) => (out[p] = (seqs.find((s) => s.nome === chaves[i])?.valor ?? 0) + 1));
  return { modelo: sistema.referenciaModelo, mes: `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`, proxima: out };
}

/** Tudo o que a skill precisa para cadastrar como o app (GET /api/skill/contexto). */
export async function contextoSkill() {
  const db = await getDb();
  const [precificacao, taxonomia, marca, fiscal, sistema, referencias, apelidos] = await Promise.all([
    getConfig("precificacao"),
    getConfig("taxonomia"),
    getConfig("marca"),
    getConfig("fiscal"),
    getConfig("sistema"),
    proximasReferencias(),
    apelidosFornecedores(),
  ]);
  const p = schema.produtos;
  const cadastrados = await db
    .select({
      referencia: p.referencia,
      codigoFornecedor: p.codigoFornecedor,
      textoOriginal: p.textoOriginal,
      especificacao: p.especificacao,
      variacao: p.variacao,
      codigoBarras: p.codigoBarras,
      codigoBarrasOrigem: p.codigoBarrasOrigem,
      nome: p.nome,
      nomeComercial: p.nomeComercial,
      tipo: p.tipo,
      subtipo: p.subtipo,
      material: p.material,
      banho: p.banho,
      corPedra: p.corPedra,
      tamanho: p.tamanho,
      precoOrigem: p.precoOrigem,
      moeda: p.moeda,
      precoVenda: p.precoVenda,
      criadoEm: p.criadoEm, // a skill ordena as candidatas como o app (mais antiga primeiro)
      fornecedor: schema.pedidos.fornecedor,
      pedido: schema.pedidos.numero,
      dataCompra: schema.pedidos.dataCompra,
    })
    .from(p)
    .leftJoin(schema.pedidos, eq(p.pedidoId, schema.pedidos.id))
    .where(and(isNull(p.recompraDe), sql`${p.referencia} is not null`));
  return {
    formato: FORMATO,
    versao: VERSAO,
    geradoEm: new Date().toISOString(),
    regras: {
      precificacao,
      taxonomia,
      marca,
      fiscal,
      sistema: {
        referenciaModelo: sistema.referenciaModelo,
        unidade: sistema.unidade,
        ncmPadrao: sistema.ncmPadrao,
        cenarioCustoPadrao: sistema.cenarioCustoPadrao,
        origemCodigoBarras: sistema.origemCodigoBarras,
        marcaUp: sistema.marcaUp,
        tipoCotacao: sistema.tipoCotacao,
        perdasPctPadrao: sistema.perdasPctPadrao,
        embalagemPorPecaPadrao: sistema.embalagemPorPecaPadrao,
      },
      // A mesma chave do app (src/lib/codigos.ts → chaveRecompra/classificarRecompra).
      recompra: {
        chave: "fornecedorChave|codigoNormalizado|especificacaoNormalizada",
        fornecedorChave: "nome ORIGINAL do fornecedor, sem espaços, em minúsculas",
        normalizacao: "código e especificação: largura total → ASCII (NFKC), maiúsculas, sem espaço, hífen ou ponto",
        regra:
          "Recompra automática só com exatamente 1 original possível e a chave inteira igual (fornecedor conhecido). Mais de um possível (mesmo código e especificação vazia ou igual), ou fornecedor desconhecido: mande recompraCandidatas com as referências possíveis.",
      },
    },
    referencias,
    // Para reconhecer recompra: mesmo fornecedor + mesmo código + mesma especificação (chaveRecompra).
    produtos: cadastrados.map(({ textoOriginal, especificacao, ...x }) => {
      const esp = especificacaoDe({ especificacao, textoOriginal, variacao: x.variacao });
      const fornecedorChave = chaveFornecedor(x.fornecedor);
      return {
        ...x,
        especificacao: esp || null,
        fornecedorChave,
        codigoNormalizado: normalizarChave(x.codigoFornecedor),
        especificacaoNormalizada: normalizarChave(esp),
        chaveRecompra: chaveRecompra(fornecedorChave, x.codigoFornecedor, esp),
        fornecedorApelido: x.fornecedor ? (apelidos.get(fornecedorChave) ?? null) : null,
      };
    }),
  };
}

/* ---------------------------------------------------------------- importar */

type Txt = string | null | undefined;
type Num = number | string | null | undefined; // números podem vir como texto ("12,5", "¥ 8.5", "0,7745")
export interface ItemPacote {
  linha: number | string | null;
  textoOriginal?: Txt;
  codigoFornecedor?: Txt;
  especificacao?: Txt;
  descricaoOriginal?: Txt;
  quantidade?: Num;
  precoOrigem?: Num;
  fotoBase64?: Txt;
  traducao?: Txt;
  tipo?: Txt;
  subtipo?: Txt;
  material?: Txt;
  banho?: Txt;
  corPedra?: string[] | null;
  tamanho?: Txt;
  variacao?: Txt;
  grupo?: Txt;
  ehConjunto?: boolean | null;
  componentes?: string[] | null;
  estilo?: Txt;
  nome?: Txt;
  nomeComercial?: Txt;
  nomesSugeridos?: string[] | null;
  avaliacao?: Txt;
  legenda?: Txt;
  hashtags?: string[] | null;
  destaque?: boolean | null;
  referencia?: Txt;
  recompraDe?: Txt;
  // Referências possíveis do original quando a skill não teve certeza da recompra (vira "recompra a confirmar").
  recompraCandidatas?: string[] | null;
  fator?: Num;
  precoManual?: Num;
  ncm?: Txt;
  alertas?: string[] | null;
}
export interface PacoteCadastro {
  formato: string;
  versao: number;
  id: string;
  pedido: {
    numero?: Txt;
    fornecedor?: Txt;
    dataCompra?: Txt;
    moeda?: Txt;
    cotacao?: Num;
    cotacaoFonte?: Txt;
    cotacaoData?: Txt;
    frete?: Num;
    fator?: Num;
    totalDocumento?: Num;
    // Opcionais: o app respeita quando existem em fiscal.json (cenários e componentes de custo).
    cenario?: Txt;
    custos?: Record<string, Num> | null;
    rateio?: Txt;
    arquivoNome?: Txt;
    cabecalho?: Txt;
    colunas?: Txt;
    observacoes?: Txt;
  };
  itens: ItemPacote[];
  /** Envio em partes (limite de tamanho da nuvem): 1..partes. Sem isso, o pacote vem inteiro. */
  parte?: number;
  partes?: number;
  totalItens?: number;
}

const t = (v: Txt, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
/** Dinheiro e quantidades: aceita número ou texto ("12,5", "¥ 8.5", "1.234,56"). */
const n = (v: unknown) => lerNumeroBr(v);
/** Cotação e fator: o ponto é sempre decimal ("0.775", "0,7745"). */
const nDecimal = (v: unknown) => lerNumeroBr(v, { milhar: false });
const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => String(x).slice(0, 300)) : null);
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/** Linha do documento num formato que o leitor do app entende (para mostrar e para a IA). */
function textoParaApp(it: ItemPacote, especificacao: string | null, preco: number | null, qtd: number): string | null {
  const original = t(it.textoOriginal, 2000);
  if (original) return original;
  if (!it.codigoFornecedor && preco == null) return null;
  const linha = Number.isInteger(Number(it.linha)) && Number(it.linha) > 0 ? String(Number(it.linha)) : "0";
  const partes = [linha, t(it.codigoFornecedor, 60), t(it.descricaoOriginal, 300), especificacao, preco, qtd, preco != null ? Math.round(preco * qtd * 100) / 100 : null];
  return partes.filter((x) => x !== null && x !== "").join(" | ");
}

function validar(p: PacoteCadastro) {
  if (!p || p.formato !== FORMATO) throw new Error(`Arquivo não é um cadastro da skill (formato "${FORMATO}").`);
  if (Number(p.versao) > VERSAO) throw new Error(`Cadastro na versão ${p.versao}; atualize o app (ele lê até a versão ${VERSAO}).`);
  if (!p.id || !/^[A-Za-z0-9_-]{8,80}$/.test(p.id)) throw new Error("Cadastro sem id válido.");
  if (!Array.isArray(p.itens)) throw new Error("Cadastro sem itens.");
  if (p.itens.length > 2000) throw new Error("Cadastro com itens demais numa parte (máx. 2000).");
}

async function bufferDaFoto(b64: Txt): Promise<Buffer | null> {
  if (!b64) return null;
  const limpo = b64.replace(/^data:[^;]+;base64,/, "");
  try {
    const buf = Buffer.from(limpo, "base64");
    return buf.length > 100 ? buf : null;
  } catch {
    return null;
  }
}

/** Número da sequência dentro da referência, pelo modelo (ex.: "{PREFIXO}_{AA}{MM}{SEQ:3}" e "BR_2611034" → 34). */
export function sequenciaDaReferencia(modelo: string, prefixo: string, referencia: string): number | null {
  return lerReferencia(modelo, prefixo, referencia)?.sequencia ?? null;
}

/**
 * Garante que o contador do app fique à frente das referências que vieram da skill.
 * O mês da sequência sai da própria referência (PREFIXO_AAMMSSS), não da data de hoje.
 */
async function avancarSequencias(referencias: { referencia: string; tipo: string | null }[]) {
  if (!referencias.length) return;
  const [tax, sistema] = await Promise.all([getConfig("taxonomia"), getConfig("sistema")]);
  const db = await getDb();
  const maior = new Map<string, number>();
  const prefixos = [...new Set(tax.tipos.map((x) => x.prefixo).filter(Boolean) as string[]), "SJ"];
  for (const r of referencias) {
    const doTipo = tax.tipos.find((x) => x.id === r.tipo)?.prefixo;
    for (const prefixo of doTipo ? [doTipo, ...prefixos] : prefixos) {
      const lida = lerReferencia(sistema.referenciaModelo, prefixo, r.referencia);
      if (!lida) continue;
      const data = lida.ano && lida.mes ? new Date(lida.ano, lida.mes - 1, 1) : new Date();
      const chave = chaveSequenciaReferencia(sistema.referenciaModelo, prefixo, data);
      maior.set(chave, Math.max(maior.get(chave) ?? 0, lida.sequencia));
      break;
    }
  }
  for (const [nome, valor] of maior)
    await db
      .insert(schema.sequencias)
      .values({ nome, valor })
      .onConflictDoUpdate({ target: schema.sequencias.nome, set: { valor: sql`max(${schema.sequencias.valor}, ${valor})` } });
}

export interface ResultadoImportacao {
  pedidoId: string;
  numero: string | null;
  itens: number;
  recebidos: number;
  esperados: number | null;
  concluido: boolean;
  jaImportado: boolean;
  recompras: number;
  aConfirmar: number; // peças com "recompra a confirmar"
  referenciasTrocadas: { linha: number; antes: string; depois: string | null }[];
  avisos: string[];
}

/** Impressão digital da peça como fica gravada (reconhece o reenvio de uma linha renumerada). */
const marcaDaPeca = (x: { codigoFornecedor: string | null; especificacao: string | null; textoOriginal: string | null; precoOrigem: number | null; quantidade: number }) =>
  JSON.stringify([x.codigoFornecedor ?? null, x.especificacao ?? null, x.textoOriginal ?? null, x.precoOrigem ?? null, x.quantidade]);

/**
 * Importa (uma parte de) um cadastro feito na skill. Idempotente pelo `id` do cadastro:
 * reenviar a mesma parte não duplica peças; reenviar um cadastro já concluído devolve o pedido existente.
 * Regras do app valem também aqui: cotação nunca vira 1 (sem ela, PTAX; sem PTAX, preço pendente), cenário de custo,
 * fator mínimo (fora a gestora, vale o mínimo), quantidade 0 continua 0, linhas repetidas/ausentes numeradas em sequência.
 */
export async function importarCadastro(p: PacoteCadastro, req: NextRequest | null, quem: QuemImporta): Promise<ResultadoImportacao> {
  validar(p);
  const db = await getDb();
  const [sistema, pol] = await Promise.all([getConfig("sistema"), getConfig("precificacao")]);
  const gestora = quem.p === "gestora";
  const minimo = Number(pol.fator_minimo ?? 0);
  const partes = Math.max(1, Number(p.partes) || 1);
  const parte = Math.min(partes, Math.max(1, Number(p.parte) || 1));
  const avisos: string[] = [];
  const abaixoDoMinimo: string[] = []; // usos da gestora abaixo do mínimo (histórico)

  let [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.cadastroId, p.id));
  if (pedido && pedido.status !== "importando") {
    const itens = await produtosDoPedido(pedido.id);
    return {
      pedidoId: pedido.id,
      numero: pedido.numero,
      itens: itens.length,
      recebidos: itens.length,
      esperados: itens.length,
      concluido: true,
      jaImportado: true,
      recompras: itens.filter((x) => x.recompraDe).length,
      aConfirmar: itens.filter(aguardandoRecompra).length,
      referenciasTrocadas: [],
      avisos: ["Este cadastro já tinha sido importado; nada foi duplicado."],
    };
  }
  let erroPtax: string | null = null;
  if (!pedido) {
    const moeda = ["CNY", "BRL", "USD"].includes(String(p.pedido?.moeda ?? "").toUpperCase()) ? String(p.pedido.moeda).toUpperCase() : "CNY";
    const dataCompra = /^\d{4}-\d{2}-\d{2}$/.test(String(p.pedido?.dataCompra)) ? String(p.pedido.dataCompra) : null;
    // Cotação: a do pacote; sem ela (moeda ≠ real), a PTAX da data da compra; sem PTAX, preço pendente (nunca 1).
    let cotacao: number | null = moeda === "BRL" ? 1 : nDecimal(p.pedido?.cotacao);
    if (cotacao != null && !(cotacao > 0)) cotacao = null;
    let cotacaoFonte: string | null = moeda === "BRL" ? "Real (sem conversão)" : cotacao ? (t(p.pedido?.cotacaoFonte, 200) ?? "skill do Claude") : null;
    let cotacaoData: string | null = moeda === "BRL" ? dataCompra : cotacao ? t(p.pedido?.cotacaoData, 20) : null;
    if (!cotacao) {
      const r = await buscarCotacao(moeda, dataCompra ?? new Date().toISOString().slice(0, 10), sistema.tipoCotacao);
      if (r.cotacao) {
        cotacao = r.cotacao.valor;
        cotacaoFonte = r.cotacao.fonte;
        cotacaoData = r.cotacao.data;
        avisos.push(`O cadastro veio sem cotação: usei a ${r.cotacao.fonte} de ${r.cotacao.data.split("-").reverse().join("/")} (${fmt(r.cotacao.valor)}).`);
      } else erroPtax = r.erros.join("; ") || "sem resposta";
    }
    // Cenário de custo: o do pacote (se existe no app); senão compra em real = importador nacional; senão o padrão da loja.
    const { padrao, cenarios } = await getCenarios();
    let cenario = cenarioPadraoPara(moeda, cenarios, padrao);
    const cenarioPacote = t(p.pedido?.cenario, 80);
    if (cenarioPacote) {
      if (cenarios[cenarioPacote]) cenario = cenarioPacote;
      else avisos.push(`O cenário de custo "${cenarioPacote}" do cadastro não existe no app: usei "${cenarios[cenario]?.nome ?? cenario}".`);
    }
    // Componentes de custo: o frete, os padrões da loja (perdas, embalagem) e, por cima, os do pacote que existem no app.
    const componentes = new Set((await getComponentesCusto()).map((c) => c.id));
    const custosPacote: Record<string, number> = {};
    const custosIgnorados: string[] = [];
    if (p.pedido?.custos && typeof p.pedido.custos === "object" && !Array.isArray(p.pedido.custos)) {
      for (const [k, v] of Object.entries(p.pedido.custos)) {
        const valor = n(v);
        if (componentes.has(k) && valor != null && valor >= 0) custosPacote[k] = valor;
        else custosIgnorados.push(k);
      }
    }
    if (custosIgnorados.length) avisos.push(`Componentes de custo do cadastro ignorados (não existem no app ou valor inválido): ${custosIgnorados.join(", ")}.`);
    const frete = n(p.pedido?.frete);
    const custos = {
      ...(custosIniciais({ frete, perdasPct: sistema.perdasPctPadrao, embalagemPorPeca: sistema.embalagemPorPecaPadrao }) ?? {}),
      ...custosPacote,
    };
    const rateio = ["valor", "peca"].includes(String(p.pedido?.rateio)) ? String(p.pedido.rateio) : "valor";
    // Fator do pedido abaixo do mínimo: só a gestora; de outra pessoa (ou da skill pela chave), vale o mínimo.
    let fator = nDecimal(p.pedido?.fator);
    if (!(fator != null && fator > 0)) fator = null;
    if (fator != null && fatorAbaixoDoMinimo(fator, pol)) {
      if (gestora) abaixoDoMinimo.push(`fator do pedido ×${fmt(fator)}`);
      else {
        avisos.push(`Fator do pedido ×${fmt(fator)} abaixo do mínimo da loja (×${fmt(minimo)}): usei ×${fmt(minimo)}. Só a gestora pode usar um fator menor.`);
        fator = minimo;
      }
    }
    [pedido] = await db
      .insert(schema.pedidos)
      .values({
        id: novoId(),
        cadastroId: p.id,
        numero: t(p.pedido?.numero, 80),
        fornecedor: t(p.pedido?.fornecedor, 200),
        dataCompra,
        moeda,
        cotacao: cotacao ?? 0,
        cotacaoFonte,
        cotacaoData,
        cenario,
        custos: Object.keys(custos).length ? custos : null,
        rateio,
        fator,
        totalDocumento: n(p.pedido?.totalDocumento),
        cabecalho: t(p.pedido?.cabecalho, 5000),
        colunas: t(p.pedido?.colunas, 1000),
        observacoes: t(p.pedido?.observacoes, 2000),
        arquivoNome: t(p.pedido?.arquivoNome, 200) ?? "cadastro do Claude",
        status: "importando",
      })
      .returning();
  }

  // Itens desta parte. A mesma peça reenviada não duplica; linha repetida/ausente é numerada em sequência.
  const existentes = await db
    .select({
      linha: schema.produtos.linha,
      codigoFornecedor: schema.produtos.codigoFornecedor,
      especificacao: schema.produtos.especificacao,
      textoOriginal: schema.produtos.textoOriginal,
      precoOrigem: schema.produtos.precoOrigem,
      quantidade: schema.produtos.quantidade,
    })
    .from(schema.produtos)
    .where(eq(schema.produtos.pedidoId, pedido.id));
  const preparados = p.itens.map((it) => {
    const q = quantidadeDoPacote(it.quantidade);
    const especificacao = t(it.especificacao, 40);
    const precoOrigem = n(it.precoOrigem);
    const valores = {
      codigoFornecedor: t(it.codigoFornecedor, 60)?.toUpperCase() ?? null,
      especificacao,
      textoOriginal: textoParaApp(it, especificacao, precoOrigem, q.quantidade),
      precoOrigem,
      quantidade: q.quantidade,
    };
    return { it, alertaQtd: q.alerta, valores, marca: marcaDaPeca(valores) };
  });
  const numeracao = numerarLinhasPacote(
    preparados.map((x) => ({ linha: x.it.linha, marca: x.marca })),
    existentes.filter((e) => e.linha != null).map((e) => ({ linha: e.linha!, marca: marcaDaPeca(e) })),
    Math.max(0, Math.round(n(p.totalItens) ?? 0)),
  );
  if (numeracao.renumeradas.length)
    avisos.push(
      `${numeracao.renumeradas.length} linha(s) do cadastro vieram repetidas ou sem número: numerei em sequência (${numeracao.renumeradas
        .slice(0, 10)
        .map((r) => `${r.de} → ${r.para}`)
        .join(", ")}${numeracao.renumeradas.length > 10 ? "…" : ""}).`,
    );

  let gravados = 0;
  let fatoresAjustados = 0;
  let quantidadesZero = 0;
  for (const [idx, { it, alertaQtd, valores }] of preparados.entries()) {
    const linha = numeracao.linhas[idx];
    if (linha == null) continue; // já importada (reenvio)
    const produtoId = novoId();
    const foto = await bufferDaFoto(it.fotoBase64);
    let imagemId: string | null = null;
    if (foto) {
      try {
        imagemId = await salvarImagem({ dados: foto, origem: "catalogo", produtoId, pedidoId: pedido.id });
      } catch {
        avisos.push(`Linha ${linha}: a foto não pôde ser lida.`);
      }
    }
    const alertas = lista(it.alertas)?.filter((a) => !/^Fator ×|abaixo do mínimo|^Recompra de |^Custo mudou|^Sem cotação/i.test(a)) ?? [];
    if (alertaQtd) alertas.push(alertaQtd);
    if (valores.quantidade === 0) quantidadesZero++;
    let fator = nDecimal(it.fator);
    if (!(fator != null && fator > 0)) fator = null;
    if (fator != null && fatorAbaixoDoMinimo(fator, pol)) {
      if (gestora) abaixoDoMinimo.push(`linha ${linha}: fator ×${fmt(fator)}`);
      else {
        alertas.push(`Pacote: fator ×${fmt(fator)} abaixo do mínimo; usei ×${fmt(minimo)} (só a gestora pode usar fator menor).`);
        fator = minimo;
        fatoresAjustados++;
      }
    }
    const precoManual = n(it.precoManual);
    // Referências possíveis do original (a skill não teve certeza): "recompra a confirmar" na tela do pedido.
    const refsCandidatas = [...new Set((lista(it.recompraCandidatas) ?? []).map((r) => r.trim().toUpperCase()).filter(Boolean))];
    let candidatas: string[] | null = null;
    if (refsCandidatas.length) {
      const achados = await db
        .select({
          id: schema.produtos.id,
          referencia: schema.produtos.referencia,
          codigoFornecedor: schema.produtos.codigoFornecedor,
          especificacao: schema.produtos.especificacao,
          textoOriginal: schema.produtos.textoOriginal,
          variacao: schema.produtos.variacao,
          criadoEm: schema.produtos.criadoEm,
          fornecedor: schema.pedidos.fornecedor,
        })
        .from(schema.produtos)
        .leftJoin(schema.pedidos, eq(schema.produtos.pedidoId, schema.pedidos.id))
        .where(
          and(
            isNull(schema.produtos.recompraDe),
            inArray(sql<string>`upper(${schema.produtos.referencia})`, refsCandidatas),
            or(isNull(schema.produtos.pedidoId), ne(schema.produtos.pedidoId, pedido.id)),
          ),
        );
      const ordem = (r: string | null) => refsCandidatas.indexOf((r ?? "").toUpperCase());
      achados.sort((a, b) => ordem(a.referencia) - ordem(b.referencia) || a.criadoEm.localeCompare(b.criadoEm));
      // A mesma referência pode ter variações (outra cor/tamanho): ficam só as que casam com a chave da recompra
      // desta peça (fornecedor + código + especificação, como na detecção do app); se nenhuma casar, todas.
      const r = classificarRecompra(
        { codigo: valores.codigoFornecedor, especificacao: valores.especificacao, fornecedorChave: chaveFornecedor(pedido.fornecedor) },
        achados.map((a) => ({ id: a.id, codigo: a.codigoFornecedor, especificacao: especificacaoDe(a), fornecedorChave: chaveFornecedor(a.fornecedor), criadoEm: a.criadoEm })),
      );
      const casam = new Set([...(r.automatico ? [r.automatico] : []), ...r.candidatas]);
      candidatas = (casam.size ? achados.filter((a) => casam.has(a.id)) : achados).map((a) => a.id);
      if (!candidatas.length) {
        candidatas = null;
        avisos.push(`Linha ${linha}: as referências candidatas à recompra (${refsCandidatas.join(", ")}) não existem no app.`);
      }
    }
    const nome = t(it.nome, 200);
    const tipo = t(it.tipo, 60);
    await db.insert(schema.produtos).values({
      id: produtoId,
      pedidoId: pedido.id,
      linha,
      textoOriginal: valores.textoOriginal,
      codigoFornecedor: valores.codigoFornecedor,
      descricaoOriginal: t(it.descricaoOriginal, 500),
      // A especificação do fornecedor (G, MR, 金色…) é a chave da recompra; a variação é a da classificação (ex.: "esmalte rosa").
      especificacao: valores.especificacao,
      recompraCandidatas: candidatas,
      traducao: t(it.traducao, 1000),
      nome: nome?.toUpperCase() ?? null,
      nomeComercial: t(it.nomeComercial, 200),
      nomesSugeridos: lista(it.nomesSugeridos),
      avaliacao: t(it.avaliacao, 2000),
      legenda: t(it.legenda, 3000),
      hashtags: lista(it.hashtags),
      destaque: !!it.destaque,
      tipo,
      subtipo: t(it.subtipo, 80),
      material: t(it.material, 60),
      banho: t(it.banho, 60),
      corPedra: lista(it.corPedra),
      tamanho: t(it.tamanho, 80),
      variacao: t(it.variacao, 120),
      grupo: t(it.grupo, 80),
      ehConjunto: !!it.ehConjunto,
      componentes: lista(it.componentes),
      estilo: t(it.estilo, 80),
      quantidade: valores.quantidade,
      precoOrigem: valores.precoOrigem,
      moeda: pedido.moeda,
      fator,
      precoManual: precoManual != null && precoManual > 0 ? precoManual : null,
      // Recompra a confirmar: a referência sai da decisão ("É esta" = a do original; "Não é recompra" = nova).
      referencia: candidatas ? null : (t(it.referencia, 40)?.toUpperCase() ?? null),
      ncm: t(it.ncm, 12),
      unidade: sistema.unidade,
      imagemId,
      status: nome && tipo ? "revisado" : "rascunho",
      alertas,
    });
    gravados++;
  }
  if (fatoresAjustados) avisos.push(`${fatoresAjustados} peça(s) com fator abaixo do mínimo da loja: usei ×${fmt(minimo)} (só a gestora pode usar fator menor).`);
  if (quantidadesZero) avisos.push(`${quantidadesZero} peça(s) com quantidade 0 no cadastro: ficaram com 0, confira.`);

  const recebidos = (await db.select({ id: schema.produtos.id }).from(schema.produtos).where(eq(schema.produtos.pedidoId, pedido.id))).length;
  const esperados = n(p.totalItens);
  const concluir = parte >= partes || (esperados != null && recebidos >= esperados);
  if (!concluir) {
    await registrarAbaixoDoMinimo(req, quem, pedido, abaixoDoMinimo);
    return { pedidoId: pedido.id, numero: pedido.numero, itens: gravados, recebidos, esperados, concluido: false, jaImportado: false, recompras: 0, aConfirmar: 0, referenciasTrocadas: [], avisos };
  }

  /* ------------------------------------------------------- conclusão */
  // 1. Recompra: o app confere com tudo o que já foi cadastrado (mesma regra da importação de PDF).
  const recompras = await detectarRecompras(pedido.id);
  // 2. Referências da skill que já são de outra peça no app (e não é recompra): o app troca e avisa.
  const itens = await produtosDoPedido(pedido.id);
  const trocadas: ResultadoImportacao["referenciasTrocadas"] = [];
  const aceitas: { referencia: string; tipo: string | null }[] = [];
  for (const it of itens) {
    if (it.recompraDe || !it.referencia) continue;
    if (aguardandoRecompra(it)) {
      // A detecção achou mais de um original possível: a referência espera a decisão na tela do pedido.
      await db.update(schema.produtos).set({ referencia: null }).where(eq(schema.produtos.id, it.id));
      continue;
    }
    const [outra] = await db
      .select({ id: schema.produtos.id })
      .from(schema.produtos)
      // Comparação exata sem diferenciar maiúsculas ("_" da referência não pode virar curinga do LIKE).
      .where(and(sql`upper(${schema.produtos.referencia}) = ${it.referencia.toUpperCase()}`, ne(schema.produtos.pedidoId, pedido.id), isNull(schema.produtos.recompraDe)))
      .limit(1);
    if (outra) {
      await db.update(schema.produtos).set({ referencia: null }).where(eq(schema.produtos.id, it.id));
      trocadas.push({ linha: it.linha ?? 0, antes: it.referencia, depois: null });
    } else aceitas.push({ referencia: it.referencia, tipo: it.tipo });
  }
  await avancarSequencias(aceitas);
  // 3. Variações sem grupo, referências que faltam e preços pelas regras atuais do app.
  await agruparVariacoesAutomaticas(pedido.id);
  await gerarCodigos(itens.filter((x) => !x.referencia || trocadas.some((tr) => tr.linha === x.linha)).map((x) => x.id));
  await recalcularPedido(pedido.id);
  // 4. Preço manual abaixo do fator mínimo (agora o custo é conhecido): só a gestora; senão vale o preço calculado.
  let manuaisTirados = 0;
  for (const x of await produtosDoPedido(pedido.id)) {
    if (!x.precoManual || x.recompraDe) continue;
    const m = precoManualAbaixoDoMinimo(x.precoManual, x.custoTotalBrl, pol);
    if (!m.abaixo) continue;
    if (gestora) {
      abaixoDoMinimo.push(`linha ${x.linha}: preço ${brl(x.precoManual)} (fator ×${fmt(m.fatorEfetivo!)})`);
      continue;
    }
    await db
      .update(schema.produtos)
      .set({ precoManual: null, alertas: [...(x.alertas ?? []), `Pacote: preço ${brl(x.precoManual)} abaixo do fator mínimo; ficou o preço calculado.`] })
      .where(eq(schema.produtos.id, x.id));
    manuaisTirados++;
  }
  if (manuaisTirados) {
    avisos.push(`${manuaisTirados} preço(s) fixado(s) no cadastro abaixo do fator mínimo da loja: ficou o preço calculado (só a gestora pode usar preço menor).`);
    await recalcularPedido(pedido.id);
  }
  if (trocadas.length) {
    const depois = await produtosDoPedido(pedido.id);
    for (const tr of trocadas) {
      tr.depois = depois.find((x) => x.linha === tr.linha)?.referencia ?? null;
      const prod = depois.find((x) => x.linha === tr.linha);
      if (prod)
        await db
          .update(schema.produtos)
          .set({ alertas: [...(prod.alertas ?? []), `A referência ${tr.antes} da skill já era de outra peça no app; ficou ${tr.depois}. Use a nova na planilha do UP.`] })
          .where(eq(schema.produtos.id, prod.id));
    }
    avisos.push(`${trocadas.length} referência(s) já existiam no app e foram trocadas. Baixe a planilha do UP pelo app antes de cadastrar no UP.`);
  }
  const [atual] = await db.select({ moeda: schema.pedidos.moeda, cotacao: schema.pedidos.cotacao }).from(schema.pedidos).where(eq(schema.pedidos.id, pedido.id));
  if (atual && atual.moeda !== "BRL" && !(atual.cotacao > 0))
    avisos.push(
      `O cadastro veio sem cotação${erroPtax ? ` e não consegui buscar a PTAX (${erroPtax})` : ""}: os preços ficaram pendentes. Informe a cotação no pedido (ou use o botão PTAX).`,
    );
  await db.update(schema.pedidos).set({ status: "analisado" }).where(eq(schema.pedidos.id, pedido.id));
  const final = await produtosDoPedido(pedido.id);
  const aConfirmar = final.filter(aguardandoRecompra).length;
  if (aConfirmar) avisos.push(`${aConfirmar} peça(s) com recompra a confirmar: abra o pedido e escolha o original (ou "Não é recompra").`);
  await registrarAbaixoDoMinimo(req, quem, pedido, abaixoDoMinimo);
  await registrar(
    req,
    {
      acao: "skill.importar",
      entidade: "pedido",
      entidadeId: pedido.id,
      resumo: `Cadastro do Claude importado: pedido ${pedido.numero ?? "sem número"} (${final.length} peça(s), ${recompras} recompra(s)${aConfirmar ? `, ${aConfirmar} a confirmar` : ""})`,
      dados: { cadastroId: p.id, trocadas },
    },
    quem,
  );
  return { pedidoId: pedido.id, numero: pedido.numero, itens: gravados, recebidos: final.length, esperados, concluido: true, jaImportado: false, recompras, aConfirmar, referenciasTrocadas: trocadas, avisos };
}

/** Histórico: a gestora importou fator/preço abaixo do mínimo da loja. */
async function registrarAbaixoDoMinimo(req: NextRequest | null, quem: QuemImporta, pedido: { id: string; numero: string | null }, usos: string[]) {
  if (!usos.length) return;
  await registrar(
    req,
    {
      acao: "preco.abaixo_minimo",
      entidade: "pedido",
      entidadeId: pedido.id,
      resumo: `Cadastro do Claude (pedido ${pedido.numero ?? "sem número"}) com fator/preço abaixo do mínimo: ${usos.slice(0, 20).join("; ")}${usos.length > 20 ? "…" : ""}`,
    },
    quem,
  );
}
