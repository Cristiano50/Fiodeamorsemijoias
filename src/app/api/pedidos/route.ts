import { NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { buscarCotacao } from "@/lib/cambio";
import { getCenarios, getConfig } from "@/lib/config";
import { lerLinha } from "@/lib/extracao";
import { agruparVariacoesAutomaticas, novoId, recalcularPedido, salvarImagem } from "@/lib/servicos";

export const maxDuration = 300;

/** Lista de pedidos com totais. */
export async function GET() {
  try {
    const db = await getDb();
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
        linhas: sql<number>`(select count(*) from produtos p where p.pedido_id = ${schema.pedidos.id})`,
        pecas: sql<number>`(select coalesce(sum(p.quantidade),0) from produtos p where p.pedido_id = ${schema.pedidos.id})`,
        custo: sql<number>`(select coalesce(sum(p.custo_total_brl * p.quantidade),0) from produtos p where p.pedido_id = ${schema.pedidos.id})`,
        venda: sql<number>`(select coalesce(sum(p.preco_venda * p.quantidade),0) from produtos p where p.pedido_id = ${schema.pedidos.id})`,
      })
      .from(schema.pedidos)
      .orderBy(desc(schema.pedidos.criadoEm));
    return ok(lista);
  } catch (e) {
    return erro(e);
  }
}

interface MetaPedido {
  numero?: string;
  fornecedor?: string;
  dataCompra?: string;
  moeda?: string;
  cotacao?: number;
  cabecalho?: string;
  colunas?: string;
  totalDocumento?: number | null;
  arquivoNome?: string;
}

/**
 * Cria o pedido a partir do que o navegador extraiu do PDF/fotos:
 *  - itens: [{ linha, texto, campo }] + arquivos "item_N" (foto recortada de cada linha)
 *  - paginas: arquivos "pagina_N" (fotos/páginas sem tabela — a IA localiza as peças depois)
 *  - arquivo: documento original
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const meta = JSON.parse(String(form.get("meta") ?? "{}")) as MetaPedido;
    const itens = JSON.parse(String(form.get("itens") ?? "[]")) as { linha: number; texto: string; campo?: string }[];
    const db = await getDb();
    const sistema = await getConfig("sistema");

    const moeda = (meta.moeda || "CNY").toUpperCase();
    const dataCompra = meta.dataCompra || new Date().toISOString().slice(0, 10);
    let cotacao = meta.cotacao && meta.cotacao > 0 ? meta.cotacao : null;
    let cotacaoFonte = cotacao ? "Informada manualmente" : null;
    let cotacaoData: string | null = cotacao ? dataCompra : null;
    const avisos: string[] = [];
    if (!cotacao) {
      const r = await buscarCotacao(moeda, dataCompra, sistema.tipoCotacao);
      if (r.cotacao) {
        cotacao = r.cotacao.valor;
        cotacaoFonte = r.cotacao.fonte;
        cotacaoData = r.cotacao.data;
      } else {
        avisos.push(`Não consegui buscar a cotação (${r.erros.join("; ")}). Informe manualmente no pedido.`);
      }
    }

    const { padrao, cenarios } = await getCenarios();
    const cenario = moeda === "BRL" && cenarios.compra_importador_nacional ? "compra_importador_nacional" : padrao;

    const pedidoId = novoId();
    await db.insert(schema.pedidos).values({
      id: pedidoId,
      numero: meta.numero || null,
      fornecedor: meta.fornecedor || null,
      dataCompra,
      moeda,
      cotacao: cotacao ?? 0,
      cotacaoFonte,
      cotacaoData,
      cenario,
      totalDocumento: meta.totalDocumento ?? null,
      cabecalho: meta.cabecalho || null,
      colunas: meta.colunas || null,
      arquivoNome: meta.arquivoNome || null,
      status: "extraido",
    });

    const arquivo = form.get("arquivo");
    if (arquivo instanceof File && arquivo.size < 30 * 1024 * 1024) {
      await db.insert(schema.arquivos).values({
        id: novoId(),
        pedidoId,
        nome: arquivo.name,
        mime: arquivo.type || "application/octet-stream",
        dados: Buffer.from(await arquivo.arrayBuffer()),
      });
    }

    for (const it of itens) {
      const produtoId = novoId();
      const f = it.campo ? form.get(it.campo) : null;
      const imagemId =
        f instanceof File
          ? await salvarImagem({ dados: Buffer.from(await f.arrayBuffer()), origem: "catalogo", produtoId, pedidoId })
          : null;
      const lida = lerLinha(it.texto);
      await db.insert(schema.produtos).values({
        id: produtoId,
        pedidoId,
        linha: it.linha,
        textoOriginal: it.texto,
        codigoFornecedor: lida.codigo ?? null,
        descricaoOriginal: lida.descricao ?? null,
        variacao: lida.especificacao ?? null,
        precoOrigem: lida.preco ?? null,
        quantidade: lida.quantidade ?? 1,
        moeda,
        unidade: sistema.unidade,
        imagemId,
      });
    }

    let ordem = 0;
    for (const [campo, valor] of form.entries()) {
      if (!campo.startsWith("pagina_") || !(valor instanceof File)) continue;
      const imagemId = await salvarImagem({ dados: Buffer.from(await valor.arrayBuffer()), origem: "pagina", pedidoId });
      await db.insert(schema.paginas).values({ id: novoId(), pedidoId, ordem: ordem++, imagemId, texto: null });
    }

    await agruparVariacoesAutomaticas(pedidoId);
    await recalcularPedido(pedidoId);
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
    return ok({ id: pedidoId, pedido, avisos, paginas: ordem });
  } catch (e) {
    return erro(e);
  }
}
