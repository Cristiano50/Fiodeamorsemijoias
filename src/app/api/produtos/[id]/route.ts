import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { recalcularProduto } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [produto] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    if (!produto) return erro("Produto não encontrado", 404);
    const imagens = await db
      .select({ id: schema.imagens.id, origem: schema.imagens.origem, largura: schema.imagens.largura, altura: schema.imagens.altura, meta: schema.imagens.meta, criadoEm: schema.imagens.criadoEm })
      .from(schema.imagens)
      .where(eq(schema.imagens.produtoId, id))
      .orderBy(desc(schema.imagens.criadoEm));
    const pedido = produto.pedidoId
      ? (await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, produto.pedidoId)))[0] ?? null
      : null;
    return ok({ produto, imagens, pedido });
  } catch (e) {
    return erro(e);
  }
}

const EDITAVEIS = [
  "nome", "nomeComercial", "traducao", "descricaoOriginal", "codigoFornecedor", "legenda", "hashtags", "destaque",
  "tipo", "subtipo", "material", "banho", "corPedra", "tamanho", "variacao", "grupo", "ehConjunto", "componentes", "estilo",
  "quantidade", "precoOrigem", "fator", "referencia", "codigoBarras", "ncm", "unidade", "imagemId", "status",
] as const;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const set: Record<string, unknown> = { atualizadoEm: new Date().toISOString() };
    for (const c of EDITAVEIS) if (c in body) set[c] = body[c];
    if ("precoVenda" in body) set.precoManual = Number(body.precoVenda) > 0 ? Number(body.precoVenda) : null;
    const db = await getDb();
    await db.update(schema.produtos).set(set).where(eq(schema.produtos.id, id));
    const mexeuPreco = ["precoOrigem", "quantidade", "fator", "tipo"].some((c) => c in body) || "precoVenda" in body;
    if (mexeuPreco) await recalcularProduto(id);
    const [produto] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    return ok({ produto });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/UNIQUE/i.test(msg)) return erro("Referência ou código de barras já usado por outro produto.", 409);
    return erro(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    await db.delete(schema.imagens).where(eq(schema.imagens.produtoId, id));
    await db.delete(schema.produtos).where(eq(schema.produtos.id, id));
    return ok();
  } catch (e) {
    return erro(e);
  }
}
