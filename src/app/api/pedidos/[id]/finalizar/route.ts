import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { aguardandoRecompra, agruparVariacoesAutomaticas, detectarRecompras, produtosDoPedido, recalcularPedido } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Depois do último lote: reconhece recompras, agrupa variações (mesmo código do fornecedor), calcula custos e preços
 * e fecha a importação (status "importando" → "extraido"). Pode ser chamado de novo sem efeito colateral.
 * Devolve as páginas/fotos que ainda esperam a IA localizar as peças.
 */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [pedido] = await db.select({ status: schema.pedidos.status }).from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    const recompras = await detectarRecompras(id);
    await agruparVariacoesAutomaticas(id);
    await recalcularPedido(id);
    if (pedido.status === "importando") await db.update(schema.pedidos).set({ status: "extraido" }).where(eq(schema.pedidos.id, id));
    const paginas = await db
      .select({ id: schema.paginas.id })
      .from(schema.paginas)
      .where(and(eq(schema.paginas.pedidoId, id), eq(schema.paginas.processada, false)));
    const aConfirmar = (await produtosDoPedido(id)).filter(aguardandoRecompra).length;
    return ok({ paginas: paginas.length, recompras, aConfirmar });
  } catch (e) {
    return erro(e);
  }
}
