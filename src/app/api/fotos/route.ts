import { NextRequest } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";

type Meta = {
  aprovada?: boolean | null;
  avaliacao?: { nota?: number; problemas?: string[]; pontos_fortes?: string[]; eliminatorios?: string[] } | null;
  tentativas?: unknown[];
  cenario?: string;
  modelo?: string;
  decisao?: "aprovada" | "recusada";
  decididoPor?: string;
  decididoEm?: string;
};

/**
 * Fila de aprovação das fotos criadas pela IA.
 * GET ?status=pendente|aprovada|recusada|todas&pedido=ID
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const status = req.nextUrl.searchParams.get("status") ?? "pendente";
    const pedido = req.nextUrl.searchParams.get("pedido");
    const db = await getDb();
    const linhas = await db
      .select({
        id: schema.imagens.id,
        meta: schema.imagens.meta,
        criadoEm: schema.imagens.criadoEm,
        produtoId: schema.produtos.id,
        nome: schema.produtos.nome,
        nomeComercial: schema.produtos.nomeComercial,
        referencia: schema.produtos.referencia,
        // Foto real da peça (catálogo do fornecedor ou enviada), para comparar com a gerada.
        fotoReal: sql<string>`coalesce((select i2.id from imagens i2 where i2.produto_id = ${schema.produtos.id} and i2.origem in ('catalogo','upload') order by i2.criado_em limit 1), ${schema.produtos.imagemId})`,
        pedidoId: schema.produtos.pedidoId,
        linha: schema.produtos.linha,
      })
      .from(schema.imagens)
      .innerJoin(schema.produtos, eq(schema.imagens.produtoId, schema.produtos.id))
      .where(and(eq(schema.imagens.origem, "ia"), pedido ? eq(schema.produtos.pedidoId, pedido) : undefined))
      .orderBy(desc(schema.imagens.criadoEm));
    const resultado = linhas.filter((l) => {
      const m = (l.meta ?? {}) as Meta;
      if (status === "todas") return true;
      if (status === "pendente") return !m.decisao;
      return m.decisao === status;
    });
    return ok(resultado);
  } catch (e) {
    return erro(e);
  }
}

/** PATCH { ids, decisao: "aprovada" | "recusada" | null } — decisão da loja sobre as fotos. */
export async function PATCH(req: NextRequest) {
  try {
    const u = await exigirPapel(req);
    const { ids, decisao } = (await req.json()) as { ids: string[]; decisao: "aprovada" | "recusada" | null };
    if (!ids?.length) return erro("Selecione as fotos", 400);
    const db = await getDb();
    const imgs = await db.select({ id: schema.imagens.id, meta: schema.imagens.meta }).from(schema.imagens).where(inArray(schema.imagens.id, ids));
    for (const i of imgs) {
      const meta = { ...((i.meta ?? {}) as Meta) };
      if (decisao) {
        meta.decisao = decisao;
        meta.decididoPor = u.n;
        meta.decididoEm = new Date().toISOString();
      } else {
        delete meta.decisao;
        delete meta.decididoPor;
        delete meta.decididoEm;
      }
      await db.update(schema.imagens).set({ meta }).where(eq(schema.imagens.id, i.id));
    }
    await registrar(req, {
      acao: `foto.${decisao ?? "reabrir"}`,
      entidade: "foto",
      resumo: `${imgs.length} foto(s) ${decisao === "aprovada" ? "aprovada(s)" : decisao === "recusada" ? "recusada(s)" : "devolvida(s) para a fila"}`,
      dados: { ids },
    });
    return ok({ total: imgs.length });
  } catch (e) {
    return erro(e);
  }
}
