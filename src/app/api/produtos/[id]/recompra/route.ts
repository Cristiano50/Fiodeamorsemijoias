import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { confirmarRecompra, desfazerRecompra } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/produtos/:id/recompra — decide a "recompra a confirmar" da peça.
 *  { original: "<id>" } → "É esta": vira recompra do original (referência, EAN, código do UP e preço vigente).
 *  { nova: true }       → "Não é recompra": peça nova (referência própria). A decisão não é desfeita por nova detecção.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req);
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { original?: string; nova?: boolean };
    const db = await getDb();
    const [p] = await db
      .select({ id: schema.produtos.id, linha: schema.produtos.linha, codigo: schema.produtos.codigoFornecedor, pedidoId: schema.produtos.pedidoId })
      .from(schema.produtos)
      .where(eq(schema.produtos.id, id));
    if (!p) return erro("Peça não encontrada", 404);
    const peca = `linha ${p.linha ?? "?"}${p.codigo ? ` (${p.codigo})` : ""}`;
    if (body.nova) {
      await desfazerRecompra([id]);
      await registrar(req, { acao: "recompra.nao_e", entidade: "produto", entidadeId: id, resumo: `Peça ${peca}: não é recompra (peça nova)`, dados: { pedidoId: p.pedidoId } });
      return ok({ ok: true });
    }
    if (!body.original) return erro("Escolha a peça original (ou marque que não é recompra).", 400);
    const r = await confirmarRecompra(id, body.original);
    await registrar(req, {
      acao: "recompra.confirmar",
      entidade: "produto",
      entidadeId: id,
      resumo: `Peça ${peca}: recompra de ${r.referencia} confirmada`,
      dados: { original: r.original, pedidoId: p.pedidoId },
    });
    return ok({ ok: true, referencia: r.referencia });
  } catch (e) {
    return erro(e);
  }
}
