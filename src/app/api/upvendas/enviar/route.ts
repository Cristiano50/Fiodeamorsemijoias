import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { enviarProdutos } from "@/lib/upvendas";

export const maxDuration = 300;

/** Corpo: { ids: string[], simular?: boolean } */
export async function POST(req: NextRequest) {
  try {
    const { ids, simular } = (await req.json()) as { ids: string[]; simular?: boolean };
    if (!ids?.length) return erro("Selecione os produtos", 400);
    return ok({ resultados: await enviarProdutos(ids, req.nextUrl.origin, !!simular) });
  } catch (e) {
    return erro(e, 502);
  }
}
