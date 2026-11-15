import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { buscarCotacao, hojeEmSaoPaulo } from "@/lib/cambio";
import { getConfig } from "@/lib/config";

/**
 * GET /api/cotacao?moeda=CNY&data=2026-09-26 (sem data = hoje no horário de Brasília)
 * A cotação fica guardada na tabela cotacoes: data passada não volta ao Banco Central; hoje vale por 30 minutos.
 */
export async function GET(req: NextRequest) {
  try {
    const moeda = (req.nextUrl.searchParams.get("moeda") ?? "CNY").trim().toUpperCase();
    const data = req.nextUrl.searchParams.get("data")?.trim() || hojeEmSaoPaulo();
    const sistema = await getConfig("sistema");
    return ok(await buscarCotacao(moeda, data, sistema.tipoCotacao));
  } catch (e) {
    return erro(e);
  }
}
