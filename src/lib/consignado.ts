import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb, schema } from "./db";
import { linhaVazia, ligarVenda, indexarProdutos, textoCelula } from "./vendas-calculo";
import {
  CAMPOS_CONSIGNADO,
  NOME_SITUACAO,
  SITUACOES,
  converterLinhasConsignado,
  pontuarColunaConsignado,
  resumoPorRevendedora,
  sugerirMapeamentoConsignado,
  totaisPorSituacao,
  type MapeamentoConsignado,
} from "./consignado-calculo";
import { carregarConsignado, carregarProdutos, dataValida, lerPlanilha, resumirMotivos } from "./vendas";

/**
 * Consignado (maletas) exportado do UP (item 32): prévia, importação em lotes que podem ser desfeitos
 * e o resumo por revendedora. A maleta usa isso para não mandar o que já está com alguém ou que ela devolveu.
 */

const RELATORIO = "de consignado (maletas)";

/** Passo 1: cabeçalhos, mapeamento sugerido e 10 linhas de amostra. */
export async function previaConsignado(arquivo: File) {
  const p = await lerPlanilha(arquivo, { pontuarColuna: pontuarColunaConsignado, relatorio: RELATORIO });
  const dados = p.linhas.filter((l) => !linhaVazia(l));
  return {
    arquivoNome: arquivo.name,
    cabecalhos: p.cabecalhos,
    mapeamento: sugerirMapeamentoConsignado(p.cabecalhos),
    amostra: dados.slice(0, 10).map((l) => p.cabecalhos.map((_, i) => textoCelula(l[i]))),
    totalLinhas: dados.length,
    linhaCabecalho: p.linhaCabecalho,
    campos: CAMPOS_CONSIGNADO,
    situacoes: SITUACOES.map((id) => ({ id, nome: NOME_SITUACAO[id] })),
  };
}

export interface OpcoesConsignado {
  revendedoraPadrao?: string | null; // planilha de uma maleta só, sem a coluna da revendedora
  dataPadrao?: string | null;
  simular?: boolean; // só confere e resume, sem gravar
}

/** Mantém só campos conhecidos com índice de coluna válido. */
export function lerMapeamentoConsignado(bruto: unknown): MapeamentoConsignado {
  const mapa: MapeamentoConsignado = {};
  if (!bruto || typeof bruto !== "object") return mapa;
  for (const c of CAMPOS_CONSIGNADO) {
    const v = (bruto as Record<string, unknown>)[c.id];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0) mapa[c.id] = n;
  }
  return mapa;
}

/** Passo 2: confere (simular) ou grava as linhas num lote. Para a mesma revendedora + data + peça, o lote mais novo vale. */
export async function importarConsignado(arquivo: File, mapa: MapeamentoConsignado, opcoes: OpcoesConsignado = {}) {
  const tem = (c: keyof MapeamentoConsignado) => mapa[c] != null && mapa[c]! >= 0;
  if (!tem("referencia") && !tem("codigoBarras")) throw new Error("Indique a coluna da referência ou a do código de barras.");
  const revendedoraPadrao = opcoes.revendedoraPadrao?.replace(/\s+/g, " ").trim().slice(0, 120) || null;
  if (!tem("revendedora") && !revendedoraPadrao) throw new Error("Indique a coluna da revendedora (ou o nome dela, se a planilha for de uma maleta só).");

  const p = await lerPlanilha(arquivo, { pontuarColuna: pontuarColunaConsignado, relatorio: RELATORIO });
  const { itens, ignoradas } = converterLinhasConsignado(p.linhas, mapa, {
    primeiraLinha: p.linhaCabecalho + 1,
    revendedoraPadrao,
    dataPadrao: dataValida(opcoes.dataPadrao),
  });
  if (!itens.length) {
    const motivos = resumirMotivos(ignoradas);
    throw new Error(`Nenhuma linha válida. ${Object.entries(motivos).map(([m, n]) => `${n}× ${m}`).join("; ") || "A planilha não tem dados."}`);
  }

  const idx = indexarProdutos(await carregarProdutos());
  const loteId = randomUUID();
  let ligadas = 0;
  const registros: (typeof schema.consignado.$inferInsert)[] = itens.map((i) => {
    const { produto } = ligarVenda({ codigoBarras: i.codigoBarras, referencia: i.referencia, produtoId: null }, idx);
    if (produto) ligadas++;
    return {
      id: randomUUID(),
      loteId,
      data: i.data,
      revendedora: i.revendedora.slice(0, 120),
      codigoBarras: i.codigoBarras,
      referencia: i.referencia,
      produtoId: produto?.id ?? null,
      descricao: i.descricao?.slice(0, 300) ?? null,
      quantidade: Math.max(1, Math.round(i.quantidade)), // a coluna é inteira; 0,4 peça não vira 0
      situacao: i.situacao,
    };
  });

  ignoradas.sort((a, b) => a.linha - b.linha);
  const datas = itens.map((i) => i.data).filter((d): d is string => !!d).sort();
  const resultado = {
    loteId: null as string | null,
    simulado: !!opcoes.simular,
    arquivoNome: arquivo.name,
    linhas: registros.length,
    ligadas,
    naoLigadas: registros.length - ligadas,
    revendedoras: new Set(itens.map((i) => i.revendedora.toLowerCase())).size,
    porSituacao: totaisPorSituacao(itens),
    periodoInicio: datas[0] ?? null,
    periodoFim: datas[datas.length - 1] ?? null,
    totalIgnoradas: ignoradas.length,
    motivos: resumirMotivos(ignoradas),
    ignoradas: ignoradas.slice(0, 500),
  };
  if (opcoes.simular) return resultado;

  const db = await getDb();
  // Tudo ou nada: o lote e as linhas no mesmo batch. 80 linhas × 11 colunas < 999 variáveis do SQLite.
  const consultas: BatchItem<"sqlite">[] = [db.insert(schema.lotesConsignado).values({ id: loteId, arquivoNome: arquivo.name, linhas: registros.length })];
  for (let i = 0; i < registros.length; i += 80) consultas.push(db.insert(schema.consignado).values(registros.slice(i, i + 80)));
  await db.batch(consultas as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  resultado.loteId = loteId;
  return resultado;
}

/** Planilhas de consignado importadas, da mais nova para a mais antiga. */
export async function listarLotesConsignado() {
  const db = await getDb();
  const l = schema.lotesConsignado;
  return db
    .select({
      id: l.id,
      arquivoNome: l.arquivoNome,
      linhas: l.linhas,
      criadoEm: l.criadoEm,
      pecas: sql<number>`(select coalesce(sum(c.quantidade), 0) from consignado c where c.lote_id = lotes_consignado.id)`,
      revendedoras: sql<number>`(select count(distinct lower(c.revendedora)) from consignado c where c.lote_id = lotes_consignado.id)`,
    })
    .from(l)
    .orderBy(desc(l.criadoEm));
}

/** Desfaz um lote: apaga as linhas dele (o lote anterior volta a valer para as mesmas peças). */
export async function excluirLoteConsignado(id: string) {
  const db = await getDb();
  const [lote] = await db.select().from(schema.lotesConsignado).where(eq(schema.lotesConsignado.id, id));
  if (!lote) return null;
  await db.batch([db.delete(schema.consignado).where(eq(schema.consignado.loteId, id)), db.delete(schema.lotesConsignado).where(eq(schema.lotesConsignado.id, id))]);
  return lote;
}

/** Resumo para a tela da maleta: por revendedora (com ela, devolvidas, vendidas, avariadas, perdidas) e as importações. */
export async function resumoConsignado() {
  const [registros, lotes, produtos] = await Promise.all([carregarConsignado(), listarLotesConsignado(), carregarProdutos()]);
  const idx = indexarProdutos(produtos);
  const naoLigadas = registros.filter((r) => !ligarVenda(r, idx).produto);
  return {
    revendedoras: resumoPorRevendedora(registros),
    totais: totaisPorSituacao(registros),
    naoLigadas: { linhas: naoLigadas.length, pecas: naoLigadas.reduce((s, r) => s + r.quantidade, 0) },
    lotes,
    atualizadoEm: lotes[0]?.criadoEm ?? null,
  };
}
