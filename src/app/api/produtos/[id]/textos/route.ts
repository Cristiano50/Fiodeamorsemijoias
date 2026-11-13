import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { textosMarketing } from "@/lib/ai/claude";
import { imagemParaIa } from "@/lib/servicos";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/** Gera legenda, hashtags e nome comercial com a IA (persona de marketing). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    if (!p) return erro("Produto não encontrado", 404);
    const r = await textosMarketing(
      { nome: p.nome, nome_comercial: p.nomeComercial, tipo: p.tipo, material: p.material, banho: p.banho, cor_pedra: p.corPedra, estilo: p.estilo, avaliacao: p.avaliacao, preco: p.precoVenda },
      p.imagemId ? await imagemParaIa(p.imagemId) : undefined,
    );
    await db.update(schema.produtos).set({ legenda: r.legenda, hashtags: r.hashtags, nomeComercial: p.nomeComercial || r.nome_comercial }).where(eq(schema.produtos.id, id));
    return ok(r);
  } catch (e) {
    return erro(e);
  }
}
