import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { usarPrecoNovoNaCadeia } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/produtos/:id/preco-novo — "Usar o preço novo para todas" (só a gestora).
 * O preço pelo custo novo desta peça (recompra com "Custo mudou") passa a valer para o original e toda a cadeia
 * (mesma referência = um preço só no UP). Devolve a lista de peças com estoque para reetiquetar.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const r = await usarPrecoNovoNaCadeia(id);
    await registrar(req, {
      acao: "preco.cadeia",
      entidade: "produto",
      entidadeId: id,
      resumo: `${r.referencia}: preço novo para todas as peças da referência (${r.pecasNaReferencia}): R$ ${r.antes ?? "—"} → R$ ${r.novo}`,
      dados: { antes: r.antes, novo: r.novo, reetiquetar: r.reetiquetar.map((x) => ({ id: x.id, pecas: x.pecas })) },
    });
    return ok(r);
  } catch (e) {
    return erro(e);
  }
}
