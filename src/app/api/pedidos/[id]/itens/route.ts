import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { adicionarItens, jaRecebidos } from "@/lib/importacao";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/** O que o pedido já recebeu (linhas do documento e ordens das páginas): a tela manda só o que falta. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [pedido] = await db.select({ status: schema.pedidos.status }).from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    return ok({ status: pedido.status, ...(await jaRecebidos(id)) });
  } catch (e) {
    return erro(e);
  }
}

/** Lote de itens/páginas do pedido (multipart). A mesma linha/página não entra duas vezes ("ignoradas"). */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok(await adicionarItens(id, await req.formData()));
  } catch (e) {
    return erro(e);
  }
}
