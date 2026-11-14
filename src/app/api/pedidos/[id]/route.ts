import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { getCenarios, getComponentesCusto } from "@/lib/config";
import { produtosDoPedido, recalcularPedido, resumoPedido } from "@/lib/servicos";
import { fotosModeloPorProduto } from "@/lib/fotos";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const resumo = await resumoPedido(id);
    if (!resumo.pedido) return erro("Pedido não encontrado", 404);
    const db = await getDb();
    const paginas = await db.select().from(schema.paginas).where(eq(schema.paginas.pedidoId, id));
    const produtos = await produtosDoPedido(id);
    return ok({
      ...resumo,
      produtos,
      fotosModelo: await fotosModeloPorProduto(produtos.map((p) => p.id)),
      paginasPendentes: paginas.filter((p) => !p.processada).length,
      componentesCusto: await getComponentesCusto(),
      cenarios: await getCenarios(),
    });
  } catch (e) {
    return erro(e);
  }
}

const CAMPOS = ["numero", "fornecedor", "dataCompra", "moeda", "cotacao", "cotacaoFonte", "cenario", "custos", "rateio", "fator", "totalDocumento", "observacoes", "status"] as const;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const set: Record<string, unknown> = {};
    for (const c of CAMPOS) if (c in body) set[c] = body[c];
    const db0 = await getDb();
    if ("cenario" in body && !("custos" in body)) {
      // Troca de cenário: volta aos valores do cenário, mas mantém o frete digitado.
      const [atual] = await db0.select({ custos: schema.pedidos.custos }).from(schema.pedidos).where(eq(schema.pedidos.id, id));
      const frete = atual?.custos?.frete_internacional;
      set.custos = frete ? { frete_internacional: frete } : null;
    }
    if ("frete" in body) {
      const [atual] = await db0.select({ custos: schema.pedidos.custos }).from(schema.pedidos).where(eq(schema.pedidos.id, id));
      const frete = Number(body.frete) > 0 ? Number(body.frete) : 0;
      set.custos = { ...(atual?.custos ?? {}), frete_internacional: frete };
    }
    if ("cotacao" in body && !("cotacaoFonte" in body)) {
      set.cotacaoFonte = "Informada manualmente";
      set.cotacaoData = body.dataCompra ?? null;
    }
    const db = await getDb();
    if (Object.keys(set).length) await db.update(schema.pedidos).set(set).where(eq(schema.pedidos.id, id));
    await recalcularPedido(id);
    return ok(await resumoPedido(id));
  } catch (e) {
    return erro(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const ids = (await db.select({ id: schema.produtos.id }).from(schema.produtos).where(eq(schema.produtos.pedidoId, id))).map((p) => p.id);
    if (ids.length) await db.delete(schema.imagens).where(inArray(schema.imagens.produtoId, ids));
    await db.delete(schema.imagens).where(eq(schema.imagens.pedidoId, id));
    await db.delete(schema.produtos).where(eq(schema.produtos.pedidoId, id));
    await db.delete(schema.paginas).where(eq(schema.paginas.pedidoId, id));
    await db.delete(schema.arquivos).where(eq(schema.arquivos.pedidoId, id));
    await db.delete(schema.pedidos).where(eq(schema.pedidos.id, id));
    return ok();
  } catch (e) {
    return erro(e);
  }
}
