import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { agruparVariacoesAutomaticas, recalcularPedido } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/** Depois do último lote: agrupa variações (mesmo código do fornecedor) e calcula custos e preços. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await agruparVariacoesAutomaticas(id);
    await recalcularPedido(id);
    const db = await getDb();
    const paginas = await db.select({ id: schema.paginas.id }).from(schema.paginas).where(eq(schema.paginas.pedidoId, id));
    return ok({ paginas: paginas.length });
  } catch (e) {
    return erro(e);
  }
}
