import { NextRequest } from "next/server";
import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { gerarCodigos, novoId, recalcularProduto, salvarImagem } from "@/lib/servicos";
import { fotosModeloPorProduto } from "@/lib/fotos";

/** GET /api/produtos?q=&tipo=&material=&cor=&status=&pedido=&up= */
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
    const lista = await db
      .select()
      .from(schema.produtos)
      .where(filtros.length ? and(...filtros) : undefined)
      .orderBy(desc(schema.produtos.criadoEm), schema.produtos.linha)
      .limit(Number(p.get("limite") ?? 500));
    // Foto criada pela IA (mais recente aprovada) de cada produto — mostrada à frente no catálogo.
    const fotos = await fotosModeloPorProduto(lista.map((x) => x.id));
    return ok(lista.map((x) => ({ ...x, fotoIa: fotos[x.id] ?? null })));
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
    const id = novoId();
    const foto = form.get("foto");
    const imagemId =
      foto instanceof File ? await salvarImagem({ dados: Buffer.from(await foto.arrayBuffer()), origem: "upload", produtoId: id }) : null;
    const custo = Number(dados.custoTotalBrl ?? 0);
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
      quantidade: Number(dados.quantidade ?? 1),
      moeda: "BRL",
      precoOrigem: custo,
      custoProdutoBrl: custo,
      custoAdicionalBrl: 0,
      custoTotalBrl: custo,
      unidade: sistema.unidade,
      imagemId,
      precoManual: dados.precoVenda ? Number(dados.precoVenda) : null,
      status: "revisado",
    });
    await recalcularProduto(id);
    await gerarCodigos([id]);
    return ok({ id });
  } catch (e) {
    return erro(e);
  }
}
