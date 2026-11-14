import { NextRequest } from "next/server";
import { and, desc, eq, like, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";

/** GET /api/historico?q=&entidade=&entidadeId=&usuario=&limite= */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const p = req.nextUrl.searchParams;
    const f: SQL[] = [];
    const q = p.get("q")?.trim();
    if (q) f.push(or(like(schema.historico.resumo, `%${q}%`), like(schema.historico.acao, `%${q}%`))!);
    if (p.get("entidade")) f.push(eq(schema.historico.entidade, p.get("entidade")!));
    if (p.get("entidadeId")) f.push(eq(schema.historico.entidadeId, p.get("entidadeId")!));
    if (p.get("usuario")) f.push(eq(schema.historico.usuarioNome, p.get("usuario")!));
    const db = await getDb();
    const lista = await db
      .select()
      .from(schema.historico)
      .where(f.length ? and(...f) : undefined)
      .orderBy(desc(schema.historico.id))
      .limit(Math.min(Number(p.get("limite") ?? 300), 2000));
    return ok(lista);
  } catch (e) {
    return erro(e);
  }
}
