import { NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { buscarCotacao } from "@/lib/cambio";
import { getCenarios, getConfig } from "@/lib/config";
import { adicionarItens } from "@/lib/importacao";
import { apelidoDe, apelidosFornecedores } from "@/lib/fornecedores";
import { agruparVariacoesAutomaticas, detectarRecompras, novoId, recalcularPedido } from "@/lib/servicos";

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
        linhas: sql<number>`(select count(*) from produtos p where p.pedido_id = pedidos.id)`,
        pecas: sql<number>`(select coalesce(sum(p.quantidade),0) from produtos p where p.pedido_id = pedidos.id)`,
        custo: sql<number>`(select coalesce(sum(p.custo_total_brl * p.quantidade),0) from produtos p where p.pedido_id = pedidos.id)`,
        venda: sql<number>`(select coalesce(sum(p.preco_venda * p.quantidade),0) from produtos p where p.pedido_id = pedidos.id)`,
      })
      .from(schema.pedidos)
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
  cotacao?: number;
  fator?: number | null;
  frete?: number | null; // frete do pedido em R$ (rateado pelo valor de cada peça)
  cotacaoSugerida?: { valor: number; data: string; fonte: string };
  cabecalho?: string;
  colunas?: string;
  totalDocumento?: number | null;
  arquivoNome?: string;
}

/**
 * Cria o pedido a partir do que o navegador extraiu do PDF/fotos:
 *  - meta: dados do pedido; arquivo: documento original (guardado se tiver até 4 MB)
 *  - itens e páginas podem vir aqui ou, de preferência, em lotes por /api/pedidos/:id/itens
 *    e depois /api/pedidos/:id/finalizar (agrupa variações e calcula preços)
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const meta = JSON.parse(String(form.get("meta") ?? "{}")) as MetaPedido;
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
      } else if (
        meta.cotacaoSugerida?.valor &&
        meta.cotacaoSugerida.data <= dataCompra &&
        Date.parse(dataCompra) - Date.parse(meta.cotacaoSugerida.data) <= 10 * 86400000
      ) {
        cotacao = meta.cotacaoSugerida.valor;
        cotacaoFonte = `${meta.cotacaoSugerida.fonte} (consultada pela tela)`;
        cotacaoData = meta.cotacaoSugerida.data;
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
      fator: meta.fator && meta.fator > 0 ? meta.fator : null,
      custos: meta.frete && meta.frete > 0 ? { frete_internacional: meta.frete } : null,
      totalDocumento: meta.totalDocumento ?? null,
      cabecalho: meta.cabecalho || null,
      colunas: meta.colunas || null,
      arquivoNome: meta.arquivoNome || null,
      status: "extraido",
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

    await detectarRecompras(pedidoId);
    await agruparVariacoesAutomaticas(pedidoId);
    await recalcularPedido(pedidoId);
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
    return ok({ id: pedidoId, pedido, avisos, paginas: lote.paginas });
  } catch (e) {
    return erro(e);
  }
}
