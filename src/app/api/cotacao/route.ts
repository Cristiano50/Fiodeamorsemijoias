import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { buscarCotacao } from "@/lib/cambio";
import { getConfig } from "@/lib/config";

/** GET /api/cotacao?moeda=CNY&data=2026-09-26 */
export async function GET(req: NextRequest) {
  try {
    const moeda = (req.nextUrl.searchParams.get("moeda") ?? "CNY").toUpperCase();
    const data = req.nextUrl.searchParams.get("data") ?? new Date().toISOString().slice(0, 10);
    const sistema = await getConfig("sistema");
    return ok(await buscarCotacao(moeda, data, sistema.tipoCotacao));
  } catch (e) {
    return erro(e);
  }
}
