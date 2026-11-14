import { NextRequest } from "next/server";
import { and, desc, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { buscarCotacao } from "@/lib/cambio";

/** GET /api/gastos?mes=AAAA-MM — gastos com IA do mês, por finalidade, modelo, pedido e dia. */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const mes = req.nextUrl.searchParams.get("mes") ?? new Date().toISOString().slice(0, 7);
    const [a, m] = mes.split("-").map(Number);
    const ini = new Date(Date.UTC(a, m - 1, 1)).toISOString();
    const fim = new Date(Date.UTC(a, m, 1)).toISOString();
    const db = await getDb();
    const periodo = and(gte(schema.gastosIa.criadoEm, ini), lt(schema.gastosIa.criadoEm, fim));
    const agrupar = async (col: typeof schema.gastosIa.finalidade | typeof schema.gastosIa.modelo | typeof schema.gastosIa.servico) =>
      db
        .select({ chave: col, chamadas: sql<number>`count(*)`, imagens: sql<number>`sum(${schema.gastosIa.imagens})`, custo: sql<number>`sum(${schema.gastosIa.custoUsd})` })
        .from(schema.gastosIa)
        .where(periodo)
        .groupBy(col)
        .orderBy(desc(sql`sum(${schema.gastosIa.custoUsd})`));
    const [porFinalidade, porModelo, porServico] = await Promise.all([agrupar(schema.gastosIa.finalidade), agrupar(schema.gastosIa.modelo), agrupar(schema.gastosIa.servico)]);
    const porPedido = await db
      .select({
        pedidoId: schema.gastosIa.pedidoId,
        numero: sql<string>`(select numero from pedidos where pedidos.id = ${schema.gastosIa.pedidoId})`,
        chamadas: sql<number>`count(*)`,
        imagens: sql<number>`sum(${schema.gastosIa.imagens})`,
        custo: sql<number>`sum(${schema.gastosIa.custoUsd})`,
        pecas: sql<number>`count(distinct ${schema.gastosIa.produtoId})`,
      })
      .from(schema.gastosIa)
      .where(periodo)
      .groupBy(schema.gastosIa.pedidoId)
      .orderBy(desc(sql`sum(${schema.gastosIa.custoUsd})`));
    const porDia = await db
      .select({ dia: sql<string>`substr(${schema.gastosIa.criadoEm}, 1, 10)`, custo: sql<number>`sum(${schema.gastosIa.custoUsd})` })
      .from(schema.gastosIa)
      .where(periodo)
      .groupBy(sql`substr(${schema.gastosIa.criadoEm}, 1, 10)`)
      .orderBy(sql`substr(${schema.gastosIa.criadoEm}, 1, 10)`);
    const total = porServico.reduce((s, r) => s + Number(r.custo ?? 0), 0);
    const sistema = await getConfig("sistema");
    const dolar = await buscarCotacao("USD", new Date().toISOString().slice(0, 10)).catch(() => null);
    return ok({
      mes,
      total,
      limite: Number(sistema.limiteMensalIaUsd ?? 0),
      dolar: dolar?.cotacao ?? null,
      precos: sistema.precosIa,
      porFinalidade,
      porModelo,
      porServico,
      porPedido,
      porDia,
    });
  } catch (e) {
    return erro(e);
  }
}
