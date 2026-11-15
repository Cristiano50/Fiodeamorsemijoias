import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { CodigoEmUso, definirCodigoBarras, recalcularPedido, recalcularProduto } from "@/lib/servicos";
import { reaplicarCotacaoEfetiva } from "@/lib/fornecedores";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { lerNumeroBr } from "@/lib/numeros";
import { checarFator, checarPrecoManual, registrarAbaixoDoMinimo } from "@/lib/permissoes";

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

/** Número de um campo (aceita "12,50", "8,5"): null = vazio; undefined = inválido. */
function numeroDoCorpo(v: unknown, milhar = true): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = lerNumeroBr(v, { milhar });
  return n == null ? undefined : n;
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    // Números digitados na tela: texto inválido não grava.
    for (const [campo, rotulo, milhar] of [
      ["fator", "Fator", false],
      ["precoOrigem", "Preço do fornecedor", true],
      ["precoVenda", "Preço de venda", true],
      ["quantidade", "Quantidade", true],
    ] as const) {
      if (!(campo in body)) continue;
      const n = numeroDoCorpo(body[campo], milhar);
      const invalido =
        n === undefined || (n !== null && n < 0) || (campo === "fator" && n === 0) || (campo === "quantidade" && (n === null || !Number.isInteger(n)));
      if (invalido) return erro(`${rotulo} inválido: "${body[campo] ?? ""}". Digite só números, ex.: ${campo === "fator" ? "10 ou 8,5" : campo === "quantidade" ? "12" : "12,50"}.`, 400);
      body[campo] = n;
    }
    const db = await getDb();
    const [antes] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    if (!antes) return erro("Produto não encontrado", 404);
    const minFator = "fator" in body ? await checarFator(req, body.fator as number | null) : null;
    const minPreco = "precoVenda" in body ? await checarPrecoManual(req, body.precoVenda as number | null, antes.custoTotalBrl) : null;
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
    const precoManual = "precoVenda" in body && Number(body.precoVenda) > 0 ? Number(body.precoVenda) : null;
    // Recompra: um preço só por código no UP. O preço fixado vai para o original (e a cadeia acompanha no recálculo).
    const raizDoPreco = "precoVenda" in body && antes.recompraDe ? antes.recompraDe : null;
    if ("precoVenda" in body && !raizDoPreco) set.precoManual = precoManual;
    await db.update(schema.produtos).set(set).where(eq(schema.produtos.id, id));
    if (raizDoPreco) {
      await db.update(schema.produtos).set({ precoManual, atualizadoEm: new Date().toISOString() }).where(eq(schema.produtos.id, raizDoPreco));
      await recalcularProduto(raizDoPreco);
    }
    const mexeuPreco = ["precoOrigem", "quantidade", "fator", "tipo"].some((c) => c in body) || "precoVenda" in body;
    // O total do pedido mudou (quantidade/preço do fornecedor): a cotação efetiva em uso é refeita antes do recálculo.
    if (antes.pedidoId && ("quantidade" in body || "precoOrigem" in body)) await reaplicarCotacaoEfetiva(antes.pedidoId);
    if (mexeuPreco) await recalcularProduto(id);
    const [produto] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    const mudou: string[] = [];
    if ("precoVenda" in body) mudou.push(`preço R$ ${antes.precoVenda} → R$ ${produto.precoVenda}${produto.precoManual ? " (manual)" : ""}`);
    else if (produto.precoVenda !== antes.precoVenda) mudou.push(`preço R$ ${antes.precoVenda} → R$ ${produto.precoVenda}`);
    if ("fator" in body && body.fator !== antes.fator) mudou.push(`fator ${antes.fator ?? "do pedido"} → ${body.fator ?? "do pedido"}`);
    for (const c of ["nome", "referencia", "codigoBarras", "status", "quantidade", "tipo"] as const)
      if (c in body && body[c] !== antes[c]) mudou.push(`${c}: ${antes[c] ?? "—"} → ${body[c] ?? "—"}`);
    if (raizDoPreco) mudou.push("preço aplicado ao original e a todas as recompras (um preço só por código no UP)");
    if (mudou.length)
      await registrar(req, { acao: "produto.alterar", entidade: "produto", entidadeId: id, resumo: `${antes.referencia ?? antes.nome ?? id.slice(0, 8)}: ${mudou.join("; ")}` });
    if (minFator?.abaixo || minPreco?.abaixo)
      await registrarAbaixoDoMinimo(req, {
        entidade: "produto",
        entidadeId: id,
        resumo: `${antes.referencia ?? antes.nome ?? id.slice(0, 8)}: ${minPreco?.abaixo ? `preço R$ ${body.precoVenda} (fator ×${minPreco.fatorEfetivo})` : `fator ×${body.fator}`} abaixo do mínimo da loja (×${(minPreco ?? minFator)!.minimo})`,
      });
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
    const [p] = await db
      .select({ referencia: schema.produtos.referencia, nome: schema.produtos.nome, pedidoId: schema.produtos.pedidoId })
      .from(schema.produtos)
      .where(eq(schema.produtos.id, id));
    await registrar(req, { acao: "produto.excluir", entidade: "produto", entidadeId: id, resumo: `Produto ${p?.referencia ?? ""} ${p?.nome ?? ""} excluído` });
    await db.delete(schema.imagens).where(eq(schema.imagens.produtoId, id));
    await db.delete(schema.produtos).where(eq(schema.produtos.id, id));
    // O pedido ficou menor: refaz a cotação efetiva (se em uso) e o rateio dos custos das outras peças.
    if (p?.pedidoId) {
      await reaplicarCotacaoEfetiva(p.pedidoId);
      await recalcularPedido(p.pedidoId);
    }
    return ok();
  } catch (e) {
    return erro(e);
  }
}
