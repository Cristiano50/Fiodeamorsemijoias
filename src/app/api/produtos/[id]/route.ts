import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { CodigoEmUso, definirCodigoBarras, recalcularProduto } from "@/lib/servicos";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { checarFator, checarPrecoManual } from "@/lib/permissoes";

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
  "nome", "nomeComercial", "nomesSugeridos", "avaliacao", "traducao", "descricaoOriginal", "codigoFornecedor", "legenda", "hashtags", "destaque",
  "tipo", "subtipo", "material", "banho", "corPedra", "tamanho", "variacao", "grupo", "ehConjunto", "componentes", "estilo",
  "quantidade", "precoOrigem", "fator", "referencia", "codigoBarras", "ncm", "unidade", "imagemId", "status",
] as const;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await req.json();
    const db = await getDb();
    const [antes] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    if (!antes) return erro("Produto não encontrado", 404);
    if ("fator" in body) await checarFator(req, body.fator);
    if ("precoVenda" in body) await checarPrecoManual(req, Number(body.precoVenda), antes.custoTotalBrl);
    // Código de barras digitado ou bipado = o código criado pelo UP. Vale para o produto e as recompras dele
    // (no UP são o mesmo produto) e só pode se repetir dentro dessa cadeia.
    if ("codigoBarras" in body && (body.codigoBarras || null) !== antes.codigoBarras) {
      try {
        await definirCodigoBarras(id, body.codigoBarras ? String(body.codigoBarras) : null, "up");
      } catch (e) {
        if (e instanceof CodigoEmUso) return erro(e.message, 409);
        throw e;
      }
    }
    const set: Record<string, unknown> = { atualizadoEm: new Date().toISOString() };
    for (const c of EDITAVEIS) if (c in body && c !== "codigoBarras") set[c] = body[c];
    if ("precoVenda" in body) set.precoManual = Number(body.precoVenda) > 0 ? Number(body.precoVenda) : null;
    await db.update(schema.produtos).set(set).where(eq(schema.produtos.id, id));
    const mexeuPreco = ["precoOrigem", "quantidade", "fator", "tipo"].some((c) => c in body) || "precoVenda" in body;
    if (mexeuPreco) await recalcularProduto(id);
    const [produto] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    const mudou: string[] = [];
    if ("precoVenda" in body) mudou.push(`preço R$ ${antes.precoVenda} → R$ ${produto.precoVenda}${produto.precoManual ? " (manual)" : ""}`);
    else if (produto.precoVenda !== antes.precoVenda) mudou.push(`preço R$ ${antes.precoVenda} → R$ ${produto.precoVenda}`);
    if ("fator" in body && body.fator !== antes.fator) mudou.push(`fator ${antes.fator ?? "do pedido"} → ${body.fator ?? "do pedido"}`);
    for (const c of ["nome", "referencia", "codigoBarras", "status", "quantidade", "tipo"] as const)
      if (c in body && body[c] !== antes[c]) mudou.push(`${c}: ${antes[c] ?? "—"} → ${body[c] ?? "—"}`);
    if (mudou.length)
      await registrar(req, { acao: "produto.alterar", entidade: "produto", entidadeId: id, resumo: `${antes.referencia ?? antes.nome ?? id.slice(0, 8)}: ${mudou.join("; ")}` });
    return ok({ produto });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/UNIQUE/i.test(msg)) return erro("Referência ou código de barras já usado por outro produto.", 409);
    return erro(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const db = await getDb();
    const [p] = await db.select({ referencia: schema.produtos.referencia, nome: schema.produtos.nome }).from(schema.produtos).where(eq(schema.produtos.id, id));
    await registrar(req, { acao: "produto.excluir", entidade: "produto", entidadeId: id, resumo: `Produto ${p?.referencia ?? ""} ${p?.nome ?? ""} excluído` });
    await db.delete(schema.imagens).where(eq(schema.imagens.produtoId, id));
    await db.delete(schema.produtos).where(eq(schema.produtos.id, id));
    return ok();
  } catch (e) {
    return erro(e);
  }
}
