import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb, schema } from "./db";
import { getConfig, salvarConfig } from "./config";
import { usuarioDaRequisicao, SemPermissao } from "./auth";
import { lerLinha } from "./extracao";
import { chaveSequenciaReferencia } from "./codigos";
import { apelidosFornecedores } from "./fornecedores";
import { registrar } from "./historico";
import {
  agruparVariacoesAutomaticas,
  detectarRecompras,
  gerarCodigos,
  novoId,
  produtosDoPedido,
  recalcularPedido,
  salvarImagem,
} from "./servicos";

/**
 * Ponte entre a skill "fiodeamor-cadastro" do Claude e o app.
 *  - contexto: o que a skill precisa para cadastrar igual ao app (regras atuais, próximas referências,
 *    produtos já cadastrados para reconhecer recompra);
 *  - importar: grava no app o cadastro feito no Claude (pedido, peças, fotos), em uma ou várias partes.
 * Formato: skill/fiodeamor-cadastro/referencias/formato-cadastro.md
 */

export const FORMATO = "fiodeamor-cadastro";
export const VERSAO = 1;
const QUEM_SKILL = { u: null, n: "Skill do Claude" };

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
export async function autorizarSkill(req: NextRequest): Promise<{ u: string | null; n: string; skill: boolean }> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (m) {
    const { skillChave } = await getConfig("sistema");
    if (skillChave && iguais(m[1], skillChave)) return { ...QUEM_SKILL, skill: true };
    throw new SemPermissao("Chave da skill inválida. Gere ou copie a chave em Configurações → Skill do Claude.");
  }
  const u = await usuarioDaRequisicao(req);
  if (!u) throw new SemPermissao("Faça login no app ou use a chave da skill.");
  return { u: u.u, n: u.n, skill: false };
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
      },
    },
    referencias,
    // Para reconhecer recompra: mesmo fornecedor + mesmo código + mesma especificação.
    produtos: cadastrados.map(({ textoOriginal, ...x }) => ({
      ...x,
      especificacao: (textoOriginal ? (lerLinha(textoOriginal).especificacao ?? "") : (x.variacao ?? "")).trim().toUpperCase() || null,
      fornecedorApelido: x.fornecedor ? (apelidos.get(x.fornecedor.replace(/\s+/g, "").toLowerCase()) ?? null) : null,
    })),
  };
}

/* ---------------------------------------------------------------- importar */

type Txt = string | null | undefined;
export interface ItemPacote {
  linha: number;
  textoOriginal?: Txt;
  codigoFornecedor?: Txt;
  especificacao?: Txt;
  descricaoOriginal?: Txt;
  quantidade?: number | null;
  precoOrigem?: number | null;
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
  fator?: number | null;
  precoManual?: number | null;
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
    cotacao?: number | null;
    cotacaoFonte?: Txt;
    cotacaoData?: Txt;
    frete?: number | null;
    fator?: number | null;
    totalDocumento?: number | null;
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
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => String(x).slice(0, 300)) : null);

/** Linha do documento num formato que o leitor do app entende (para a recompra achar a especificação). */
function textoParaApp(it: ItemPacote): string | null {
  const original = t(it.textoOriginal, 2000);
  const esp = t(it.especificacao, 40)?.toUpperCase() ?? "";
  if (original && (lerLinha(original).especificacao ?? "").trim().toUpperCase() === esp) return original;
  if (!it.codigoFornecedor && !it.precoOrigem) return original;
  const preco = n(it.precoOrigem);
  const qtd = n(it.quantidade);
  const partes = [String(it.linha), t(it.codigoFornecedor, 60), t(it.descricaoOriginal, 300), esp || null, preco, qtd, preco != null && qtd != null ? Math.round(preco * qtd * 100) / 100 : null];
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
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = "";
  let resto = modelo;
  let temSeq = false;
  while (resto.length) {
    const m = /^\{(PREFIXO|AAAA|AA|MM|S{2,}|SEQ:\d+|SEQ)\}/.exec(resto);
    if (m) {
      const tok = m[1];
      if (tok === "PREFIXO") re += esc(prefixo);
      else if (tok === "AAAA") re += "\\d{4}";
      else if (tok === "AA" || tok === "MM") re += "\\d{2}";
      else {
        re += "(\\d+)";
        temSeq = true;
      }
      resto = resto.slice(m[0].length);
    } else {
      re += esc(resto[0]);
      resto = resto.slice(1);
    }
  }
  if (!temSeq) return null;
  const r = new RegExp(`^${re}$`, "i").exec(referencia);
  return r ? Number(r[1]) : null;
}

/** Garante que o contador do app fique à frente das referências que vieram da skill. */
async function avancarSequencias(referencias: { referencia: string; tipo: string | null }[]) {
  if (!referencias.length) return;
  const [tax, sistema] = await Promise.all([getConfig("taxonomia"), getConfig("sistema")]);
  const db = await getDb();
  const maior = new Map<string, number>();
  const prefixos = [...new Set(tax.tipos.map((x) => x.prefixo).filter(Boolean) as string[]), "SJ"];
  for (const r of referencias) {
    const doTipo = tax.tipos.find((x) => x.id === r.tipo)?.prefixo;
    for (const prefixo of doTipo ? [doTipo, ...prefixos] : prefixos) {
      const seq = sequenciaDaReferencia(sistema.referenciaModelo, prefixo, r.referencia);
      if (seq == null) continue;
      const chave = chaveSequenciaReferencia(sistema.referenciaModelo, prefixo, new Date());
      maior.set(chave, Math.max(maior.get(chave) ?? 0, seq));
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
  referenciasTrocadas: { linha: number; antes: string; depois: string | null }[];
  avisos: string[];
}

/**
 * Importa (uma parte de) um cadastro feito na skill. Idempotente pelo `id` do cadastro:
 * reenviar a mesma parte não duplica peças; reenviar um cadastro já concluído devolve o pedido existente.
 */
export async function importarCadastro(p: PacoteCadastro, req: NextRequest | null, quem: { u: string | null; n: string }): Promise<ResultadoImportacao> {
  validar(p);
  const db = await getDb();
  const sistema = await getConfig("sistema");
  const partes = Math.max(1, Number(p.partes) || 1);
  const parte = Math.min(partes, Math.max(1, Number(p.parte) || 1));
  const avisos: string[] = [];

  let [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.cadastroId, p.id));
  if (pedido && pedido.status !== "importando") {
    const itens = await produtosDoPedido(pedido.id);
    return { pedidoId: pedido.id, numero: pedido.numero, itens: itens.length, recebidos: itens.length, esperados: itens.length, concluido: true, jaImportado: true, recompras: itens.filter((x) => x.recompraDe).length, referenciasTrocadas: [], avisos: ["Este cadastro já tinha sido importado; nada foi duplicado."] };
  }
  if (!pedido) {
    const moeda = ["CNY", "BRL", "USD"].includes(String(p.pedido?.moeda)) ? String(p.pedido.moeda) : "CNY";
    const frete = n(p.pedido?.frete);
    const fator = n(p.pedido?.fator);
    [pedido] = await db
      .insert(schema.pedidos)
      .values({
        id: novoId(),
        cadastroId: p.id,
        numero: t(p.pedido?.numero, 80),
        fornecedor: t(p.pedido?.fornecedor, 200),
        dataCompra: /^\d{4}-\d{2}-\d{2}$/.test(String(p.pedido?.dataCompra)) ? String(p.pedido.dataCompra) : null,
        moeda,
        cotacao: moeda === "BRL" ? 1 : (n(p.pedido?.cotacao) ?? 1),
        cotacaoFonte: t(p.pedido?.cotacaoFonte, 200) ?? "skill do Claude",
        cotacaoData: t(p.pedido?.cotacaoData, 20),
        cenario: sistema.cenarioCustoPadrao || "mercadoria_frete",
        custos: frete ? { frete_internacional: frete } : null,
        fator: fator && fator > 0 ? fator : null,
        totalDocumento: n(p.pedido?.totalDocumento),
        cabecalho: t(p.pedido?.cabecalho, 5000),
        colunas: t(p.pedido?.colunas, 1000),
        observacoes: t(p.pedido?.observacoes, 2000),
        arquivoNome: t(p.pedido?.arquivoNome, 200) ?? "cadastro do Claude",
        status: "importando",
      })
      .returning();
    if (moeda !== "BRL" && !n(p.pedido?.cotacao)) avisos.push("O cadastro veio sem cotação: confira a cotação no pedido.");
  }

  // Itens desta parte (sem duplicar a mesma linha se a parte for reenviada).
  const existentes = new Set((await db.select({ linha: schema.produtos.linha }).from(schema.produtos).where(eq(schema.produtos.pedidoId, pedido.id))).map((x) => x.linha));
  let gravados = 0;
  for (const it of p.itens) {
    const linha = Number(it.linha);
    if (!Number.isInteger(linha) || existentes.has(linha)) continue;
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
    const nome = t(it.nome, 200);
    const tipo = t(it.tipo, 60);
    await db.insert(schema.produtos).values({
      id: produtoId,
      pedidoId: pedido.id,
      linha,
      textoOriginal: textoParaApp(it),
      codigoFornecedor: t(it.codigoFornecedor, 60)?.toUpperCase() ?? null,
      descricaoOriginal: t(it.descricaoOriginal, 500),
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
      // A especificação do fornecedor (G, MR…) fica na linha original; a variação é a da classificação (ex.: "esmalte rosa").
      variacao: t(it.variacao, 120),
      grupo: t(it.grupo, 80),
      ehConjunto: !!it.ehConjunto,
      componentes: lista(it.componentes),
      estilo: t(it.estilo, 80),
      quantidade: Math.max(1, Math.round(n(it.quantidade) ?? 1)),
      precoOrigem: n(it.precoOrigem),
      moeda: pedido.moeda,
      fator: n(it.fator) && n(it.fator)! > 0 ? n(it.fator) : null,
      precoManual: n(it.precoManual) && n(it.precoManual)! > 0 ? n(it.precoManual) : null,
      referencia: t(it.referencia, 40)?.toUpperCase() ?? null,
      ncm: t(it.ncm, 12),
      unidade: sistema.unidade,
      imagemId,
      status: nome && tipo ? "revisado" : "rascunho",
      alertas: lista(it.alertas)?.filter((a) => !/^Fator ×|abaixo do mínimo|^Recompra de /i.test(a)) ?? [],
    });
    existentes.add(linha);
    gravados++;
  }

  const recebidos = existentes.size;
  const esperados = n(p.totalItens);
  const concluir = parte >= partes || (esperados != null && recebidos >= esperados);
  if (!concluir)
    return { pedidoId: pedido.id, numero: pedido.numero, itens: gravados, recebidos, esperados, concluido: false, jaImportado: false, recompras: 0, referenciasTrocadas: [], avisos };

  /* ------------------------------------------------------- conclusão */
  // 1. Recompra: o app confere com tudo o que já foi cadastrado (mesma regra da importação de PDF).
  const recompras = await detectarRecompras(pedido.id);
  // 2. Referências da skill que já são de outra peça no app (e não é recompra): o app troca e avisa.
  const itens = await produtosDoPedido(pedido.id);
  const trocadas: ResultadoImportacao["referenciasTrocadas"] = [];
  const aceitas: { referencia: string; tipo: string | null }[] = [];
  for (const it of itens) {
    if (it.recompraDe || !it.referencia) continue;
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
  await db.update(schema.pedidos).set({ status: "analisado" }).where(eq(schema.pedidos.id, pedido.id));
  const final = await produtosDoPedido(pedido.id);
  await registrar(
    req,
    {
      acao: "skill.importar",
      entidade: "pedido",
      entidadeId: pedido.id,
      resumo: `Cadastro do Claude importado: pedido ${pedido.numero ?? "sem número"} (${final.length} peça(s), ${recompras} recompra(s))`,
      dados: { cadastroId: p.id, trocadas },
    },
    quem,
  );
  return { pedidoId: pedido.id, numero: pedido.numero, itens: gravados, recebidos: final.length, esperados, concluido: true, jaImportado: false, recompras, referenciasTrocadas: trocadas, avisos };
}
