import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { lerNumeroBr } from "@/lib/numeros";
import { montarMaleta, revendedorasDoHistorico } from "@/lib/vendas";

/**
 * GET /api/maleta → revendedoras do histórico e as peças-alvo padrão (Configurações → Vendas e recompra).
 * O teto de valor é opcional e por maleta: vazio = sem teto (a maleta fecha pelas peças-alvo).
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const [historico, sistema] = await Promise.all([revendedorasDoHistorico(), getConfig("sistema")]);
    return ok({ ...historico, valorAlvo: null, pecasAlvo: Math.floor(Number(sistema.maletaPecasAlvo)) || 85 });
  } catch (e) {
    return erro(e);
  }
}

const positivo = (v: unknown) => {
  const n = lerNumeroBr(v);
  return n != null && n > 0 ? n : 0;
};

/** POST /api/maleta { revendedora?, valorAlvo? (teto em R$; vazio = sem teto), pecasAlvo?, tiposExcluidos? } → maleta sugerida, com o motivo de cada peça. */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return ok(
      await montarMaleta({
        revendedora: typeof body.revendedora === "string" ? body.revendedora : null,
        valorAlvo: positivo(body.valorAlvo),
        pecasAlvo: Math.floor(positivo(body.pecasAlvo)),
        tiposExcluidos: Array.isArray(body.tiposExcluidos) ? body.tiposExcluidos.map(String) : [],
      }),
    );
  } catch (e) {
    return erro(e);
  }
}
