import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { buscarCotacao } from "@/lib/cambio";
import { getConfig } from "@/lib/config";
import { recalcularPedido, resumoPedido } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/** Busca de novo a cotação PTAX da data da compra e recalcula os preços. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    const sistema = await getConfig("sistema");
    const r = await buscarCotacao(pedido.moeda, pedido.dataCompra ?? new Date().toISOString().slice(0, 10), sistema.tipoCotacao);
    if (!r.cotacao) return erro(`Não consegui buscar a cotação: ${r.erros.join("; ")}`, 502);
    await db
      .update(schema.pedidos)
      .set({ cotacao: r.cotacao.valor, cotacaoFonte: r.cotacao.fonte, cotacaoData: r.cotacao.data })
      .where(eq(schema.pedidos.id, id));
    await recalcularPedido(id);
    return ok({ cotacao: r.cotacao, resumo: await resumoPedido(id) });
  } catch (e) {
    return erro(e);
  }
}
