import { NextRequest } from "next/server";
import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { gerarCodigos, novoId, recalcularProduto, salvarImagem } from "@/lib/servicos";
import { lerNumeroBr } from "@/lib/numeros";
import { checarFator, checarPrecoManual, registrarAbaixoDoMinimo } from "@/lib/permissoes";
import { fotosModeloPorProduto } from "@/lib/fotos";

/**
 * GET /api/produtos?q=&tipo=&material=&cor=&status=&pedido=&up=&limite=&offset=
 * Com `offset` a tela pagina ("carregar mais"); o cabeçalho X-Total-Count traz o total dos filtros.
 */
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const filtros: SQL[] = [];
    const q = p.get("q")?.trim();
    if (q) {
      const t = `%${q}%`;
      filtros.push(
        or(
          like(schema.produtos.nome, t),
          like(schema.produtos.referencia, t),
          like(schema.produtos.codigoBarras, t),
          like(schema.produtos.codigoFornecedor, t),
          like(schema.produtos.nomeComercial, t),
        )!,
      );
    }
    for (const [param, col] of [
      ["tipo", schema.produtos.tipo],
      ["material", schema.produtos.material],
      ["status", schema.produtos.status],
      ["pedido", schema.produtos.pedidoId],
      ["up", schema.produtos.upStatus],
    ] as const) {
      const v = p.get(param);
      if (v) filtros.push(eq(col, v));
    }
    const cor = p.get("cor");
    if (cor) filtros.push(sql`exists (select 1 from json_each(${schema.produtos.corPedra}) where value = ${cor})`);
    const db = await getDb();
    const onde = filtros.length ? and(...filtros) : undefined;
    const limite = Math.min(Math.max(Number(p.get("limite") ?? 500) || 500, 1), 5000);
    const offset = Math.max(Number(p.get("offset") ?? 0) || 0, 0);
    const lista = await db
      .select()
      .from(schema.produtos)
      .where(onde)
      .orderBy(desc(schema.produtos.criadoEm), schema.produtos.linha, schema.produtos.id)
      .limit(limite)
      .offset(offset);
    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(schema.produtos).where(onde);
    // Foto criada pela IA (mais recente aprovada) de cada produto — mostrada à frente no catálogo.
    const fotos = await fotosModeloPorProduto(lista.map((x) => x.id));
    const res = ok(lista.map((x) => ({ ...x, fotoIa: fotos[x.id] ?? null })));
    res.headers.set("X-Total-Count", String(total));
    return res;
  } catch (e) {
    return erro(e);
  }
}

/** Cadastro avulso (sem pedido). multipart: dados (JSON) + foto (opcional) */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const dados = JSON.parse(String(form.get("dados") ?? "{}"));
    const sistema = await getConfig("sistema");
    // Números como na tela ("12,50", "8,5"); texto inválido não grava.
    const vazio = (v: unknown) => v === null || v === undefined || v === "";
    const custo = vazio(dados.custoTotalBrl) ? 0 : lerNumeroBr(dados.custoTotalBrl);
    if (custo == null || custo < 0) return erro(`Custo inválido: "${dados.custoTotalBrl}". Digite só o valor, ex.: 12,50.`, 400);
    const precoVenda = vazio(dados.precoVenda) ? null : lerNumeroBr(dados.precoVenda);
    if (!vazio(dados.precoVenda) && !(precoVenda != null && precoVenda >= 0)) return erro(`Preço inválido: "${dados.precoVenda}".`, 400);
    const fator = vazio(dados.fator) ? null : lerNumeroBr(dados.fator, { milhar: false });
    if (!vazio(dados.fator) && !(fator != null && fator > 0)) return erro(`Fator inválido: "${dados.fator}". Digite um número, ex.: 10 ou 8,5.`, 400);
    const quantidade = vazio(dados.quantidade) ? 1 : lerNumeroBr(dados.quantidade);
    if (quantidade == null || quantidade < 0 || !Number.isInteger(quantidade)) return erro(`Quantidade inválida: "${dados.quantidade}".`, 400);
    // Fator mínimo: funcionária recebe 403; a gestora pode (alerta na peça e histórico).
    const minFator = await checarFator(req, fator);
    const minPreco = precoVenda ? await checarPrecoManual(req, precoVenda, custo) : { abaixo: false, minimo: minFator.minimo, fatorEfetivo: null };
    const id = novoId();
    const foto = form.get("foto");
    const imagemId =
      foto instanceof File ? await salvarImagem({ dados: Buffer.from(await foto.arrayBuffer()), origem: "upload", produtoId: id }) : null;
    const db = await getDb();
    await db.insert(schema.produtos).values({
      id,
      nome: dados.nome ?? null,
      tipo: dados.tipo ?? null,
      subtipo: dados.subtipo ?? null,
      material: dados.material ?? null,
      banho: dados.banho ?? null,
      corPedra: dados.corPedra ?? [],
      tamanho: dados.tamanho ?? null,
      codigoFornecedor: dados.codigoFornecedor ?? null,
      quantidade,
      moeda: "BRL",
      precoOrigem: custo,
      custoProdutoBrl: custo,
      custoAdicionalBrl: 0,
      custoTotalBrl: custo,
      unidade: sistema.unidade,
      imagemId,
      fator,
      precoManual: precoVenda ? precoVenda : null,
      status: "revisado",
    });
    await recalcularProduto(id);
    await gerarCodigos([id]);
    if (minFator.abaixo || minPreco.abaixo)
      await registrarAbaixoDoMinimo(req, {
        entidade: "produto",
        entidadeId: id,
        resumo: `Cadastro avulso ${dados.nome ?? ""} com ${minPreco.abaixo ? `preço R$ ${precoVenda} (fator ×${minPreco.fatorEfetivo})` : `fator ×${fator}`} abaixo do mínimo (×${minFator.minimo})`,
      });
    return ok({ id });
  } catch (e) {
    return erro(e);
  }
}
