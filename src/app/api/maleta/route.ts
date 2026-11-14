import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { montarMaleta, revendedorasDoHistorico } from "@/lib/vendas";

/** GET /api/maleta → revendedoras do histórico e os alvos padrão (Configurações). */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const [historico, sistema] = await Promise.all([revendedorasDoHistorico(), getConfig("sistema")]);
    return ok({ ...historico, valorAlvo: Number(sistema.maletaValorAlvo) || 4000, pecasAlvo: Number(sistema.maletaPecasAlvo) || 85 });
  } catch (e) {
    return erro(e);
  }
}

/** POST /api/maleta { revendedora?, valorAlvo?, pecasAlvo?, tiposExcluidos? } → maleta sugerida, com o motivo de cada peça. */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return ok(
      await montarMaleta({
        revendedora: typeof body.revendedora === "string" ? body.revendedora : null,
        valorAlvo: Number(body.valorAlvo) || 0,
        pecasAlvo: Number(body.pecasAlvo) || 0,
        tiposExcluidos: Array.isArray(body.tiposExcluidos) ? body.tiposExcluidos.map(String) : [],
      }),
    );
  } catch (e) {
    return erro(e);
  }
}
