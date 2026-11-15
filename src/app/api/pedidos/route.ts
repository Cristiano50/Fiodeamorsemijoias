import { NextRequest, NextResponse } from "next/server";
import { count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { buscarCotacao } from "@/lib/cambio";
import { getCenarios, getConfig } from "@/lib/config";
import { registrar } from "@/lib/historico";
import { adicionarItens } from "@/lib/importacao";
import { apelidoDe, apelidosFornecedores, chaveFornecedor } from "@/lib/fornecedores";
import { lerNumeroBr } from "@/lib/numeros";
import { checarFator, registrarAbaixoDoMinimo } from "@/lib/permissoes";
import { cenarioPadraoPara, custosIniciais } from "@/lib/precos";
import { novoId } from "@/lib/servicos";

export const maxDuration = 300;

/** Lista de pedidos com totais. ?incompletos=1: só as importações que pararam no meio (status "importando"). */
export async function GET(req: NextRequest) {
  try {
    const db = await getDb();
    const incompletos = req.nextUrl.searchParams.get("incompletos") === "1";
    const lista = await db
      .select({
        id: schema.pedidos.id,
        numero: schema.pedidos.numero,
        fornecedor: schema.pedidos.fornecedor,
        dataCompra: schema.pedidos.dataCompra,
        moeda: schema.pedidos.moeda,
        cotacao: schema.pedidos.cotacao,
        status: schema.pedidos.status,
        criadoEm: schema.pedidos.criadoEm,
        arquivoNome: schema.pedidos.arquivoNome,
        // "skill" = cadastro do Claude (continua reenviando o mesmo arquivo .json); "documento" = PDF/fotos.
        origem: sql<string>`case when ${schema.pedidos.cadastroId} is null then 'documento' else 'skill' end`,
        linhas: sql<number>`(select count(*) from produtos p where p.pedido_id = pedidos.id)`,
        pecas: sql<number>`(select coalesce(sum(p.quantidade),0) from produtos p where p.pedido_id = pedidos.id)`,
        custo: sql<number>`(select coalesce(sum(p.custo_total_brl * p.quantidade),0) from produtos p where p.pedido_id = pedidos.id)`,
        venda: sql<number>`(select coalesce(sum(p.preco_venda * p.quantidade),0) from produtos p where p.pedido_id = pedidos.id)`,
      })
      .from(schema.pedidos)
      .where(incompletos ? eq(schema.pedidos.status, "importando") : undefined)
      .orderBy(desc(schema.pedidos.criadoEm));
    const apelidos = await apelidosFornecedores();
    return ok(lista.map((p) => ({ ...p, fornecedorApelido: apelidoDe(apelidos, p.fornecedor) })));
  } catch (e) {
    return erro(e);
  }
}

interface MetaPedido {
  numero?: string;
  fornecedor?: string;
  dataCompra?: string;
  moeda?: string;
  cotacao?: number | string;
  fator?: number | string | null;
  frete?: number | string | null; // frete do pedido em R$ (rateado pelo valor de cada peça)
  cotacaoSugerida?: { valor: number; data: string; fonte: string };
  cabecalho?: string;
  colunas?: string;
  totalDocumento?: number | null;
  arquivoNome?: string;
  forcar?: boolean; // gestora: importar de novo um pedido que já existe
}

/** Data (dd/mm/aaaa, horário de Brasília) de um carimbo ISO. */
const dataBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** Número do pedido para comparar: sem espaços, maiúsculas. */
const normNumero = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "").toUpperCase();

/** Pedido já importado com o mesmo número e o mesmo fornecedor (fornecedor vazio de um dos lados: só o número). */
async function pedidoRepetido(numero: string | null | undefined, fornecedor: string | null | undefined) {
  const n = normNumero(numero);
  if (!n) return null;
  const db = await getDb();
  const comNumero = await db
    .select({
      id: schema.pedidos.id,
      numero: schema.pedidos.numero,
      fornecedor: schema.pedidos.fornecedor,
      status: schema.pedidos.status,
      criadoEm: schema.pedidos.criadoEm,
    })
    .from(schema.pedidos)
    .where(isNotNull(schema.pedidos.numero))
    .orderBy(desc(schema.pedidos.criadoEm));
  const f = chaveFornecedor(fornecedor);
  const achado = comNumero.find((p) => normNumero(p.numero) === n && (!f || !chaveFornecedor(p.fornecedor) || chaveFornecedor(p.fornecedor) === f));
  if (!achado) return null;
  const [{ itens }] = await db.select({ itens: count() }).from(schema.produtos).where(eq(schema.produtos.pedidoId, achado.id));
  return { ...achado, itens };
}

/**
 * Cria o pedido a partir do que o navegador extraiu do PDF/fotos:
 *  - meta: dados do pedido; arquivo: documento original (guardado se tiver até 4 MB)
 *  - o pedido nasce "importando": os itens e páginas vão em lotes por /api/pedidos/:id/itens e
 *    /api/pedidos/:id/finalizar fecha a importação (recompra, variações, preços; status "extraido").
 *  - pedido repetido (mesmo número e fornecedor): 409 com { existente }; a gestora pode mandar forcar: true.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const meta = JSON.parse(String(form.get("meta") ?? "{}")) as MetaPedido;
    const db = await getDb();
    const sistema = await getConfig("sistema");

    const fator = meta.fator == null || meta.fator === "" ? null : lerNumeroBr(meta.fator, { milhar: false });
    if (meta.fator != null && meta.fator !== "" && !(fator != null && fator > 0)) return erro(`Fator inválido: "${meta.fator}". Digite um número, ex.: 10 ou 8,5.`, 400);
    const frete = meta.frete == null || meta.frete === "" ? null : lerNumeroBr(meta.frete);
    if (meta.frete != null && meta.frete !== "" && !(frete != null && frete >= 0)) return erro(`Frete inválido: "${meta.frete}". Digite só o valor, ex.: 850,50.`, 400);
    const cotacaoInformada = meta.cotacao == null || meta.cotacao === "" ? null : lerNumeroBr(meta.cotacao, { milhar: false });
    if (meta.cotacao != null && meta.cotacao !== "" && !(cotacaoInformada != null && cotacaoInformada > 0)) return erro(`Cotação inválida: "${meta.cotacao}".`, 400);

    // Fator abaixo do mínimo: funcionária recebe 403; a gestora pode (fica no histórico).
    const minimo = await checarFator(req, fator);

    const existente = await pedidoRepetido(meta.numero, meta.fornecedor);
    if (existente && !meta.forcar) {
      return NextResponse.json({ erro: `Este pedido já foi importado em ${dataBr(existente.criadoEm)}.`, existente }, { status: 409 });
    }
    if (existente) await exigirPapel(req, "gestora"); // "Importar mesmo assim"

    const moeda = ["CNY", "BRL", "USD"].includes(String(meta.moeda ?? "").toUpperCase()) ? String(meta.moeda).toUpperCase() : "CNY";
    const dataCompra = /^\d{4}-\d{2}-\d{2}$/.test(String(meta.dataCompra)) ? String(meta.dataCompra) : new Date().toISOString().slice(0, 10);
    let cotacao = moeda === "BRL" ? 1 : cotacaoInformada;
    let cotacaoFonte = moeda === "BRL" ? "Real (sem conversão)" : cotacao ? "Informada manualmente" : null;
    let cotacaoData: string | null = cotacao ? dataCompra : null;
    const avisos: string[] = [];
    if (!cotacao) {
      const r = await buscarCotacao(moeda, dataCompra, sistema.tipoCotacao);
      if (r.cotacao) {
        cotacao = r.cotacao.valor;
        cotacaoFonte = r.cotacao.fonte;
        cotacaoData = r.cotacao.data;
      } else if (
        meta.cotacaoSugerida?.valor &&
        meta.cotacaoSugerida.data <= dataCompra &&
        Date.parse(dataCompra) - Date.parse(meta.cotacaoSugerida.data) <= 10 * 86400000
      ) {
        cotacao = meta.cotacaoSugerida.valor;
        cotacaoFonte = `${meta.cotacaoSugerida.fonte} (consultada pela tela)`;
        cotacaoData = meta.cotacaoSugerida.data;
      } else {
        avisos.push(`Não consegui buscar a cotação (${r.erros.join("; ")}). Informe manualmente no pedido; até lá os preços ficam pendentes.`);
      }
    }

    const { padrao, cenarios } = await getCenarios();
    const cenario = cenarioPadraoPara(moeda, cenarios, padrao);

    const pedidoId = novoId();
    await db.insert(schema.pedidos).values({
      id: pedidoId,
      numero: meta.numero?.trim() || null,
      fornecedor: meta.fornecedor?.trim() || null,
      dataCompra,
      moeda,
      cotacao: cotacao ?? 0,
      cotacaoFonte,
      cotacaoData,
      cenario,
      fator,
      // Frete digitado + padrões da loja (perdas e defeitos, embalagem e etiqueta) quando configurados.
      custos: custosIniciais({ frete, perdasPct: sistema.perdasPctPadrao, embalagemPorPeca: sistema.embalagemPorPecaPadrao }),
      totalDocumento: typeof meta.totalDocumento === "number" ? meta.totalDocumento : null,
      cabecalho: meta.cabecalho || null,
      colunas: meta.colunas || null,
      arquivoNome: meta.arquivoNome || null,
      status: "importando",
    });

    if (existente)
      await registrar(req, {
        acao: "pedido.importar_repetido",
        entidade: "pedido",
        entidadeId: pedidoId,
        resumo: `Pedido ${meta.numero} importado de novo (já existia, importado em ${dataBr(existente.criadoEm)})`,
        dados: { existente: existente.id },
      });
    if (minimo.abaixo)
      await registrarAbaixoDoMinimo(req, {
        entidade: "pedido",
        entidadeId: pedidoId,
        resumo: `Pedido ${meta.numero ?? pedidoId.slice(0, 8)} criado com fator ×${fator} (mínimo ×${minimo.minimo})`,
      });

    const arquivo = form.get("arquivo");
    if (arquivo instanceof File && arquivo.size < 3.5 * 1024 * 1024) {
      await db.insert(schema.arquivos).values({
        id: novoId(),
        pedidoId,
        nome: arquivo.name,
        mime: arquivo.type || "application/octet-stream",
        dados: Buffer.from(await arquivo.arrayBuffer()),
      });
    }

    // Compatível com envio único; o navegador manda os itens em lotes por /api/pedidos/:id/itens.
    const lote = await adicionarItens(pedidoId, form);
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
    return ok({ id: pedidoId, pedido, avisos, paginas: lote.paginas });
  } catch (e) {
    return erro(e);
  }
}
