import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { enviarProdutos } from "@/lib/upvendas";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { urlDoApp } from "@/lib/url";

export const maxDuration = 300;

/** Corpo: { ids: string[], simular?: boolean } */
export async function POST(req: NextRequest) {
  try {
    const { ids, simular } = (await req.json()) as { ids: string[]; simular?: boolean };
    if (!ids?.length) return erro("Selecione os produtos", 400);
    await exigirPapel(req, "gestora");
    const resultados = await enviarProdutos(ids, urlDoApp(req), !!simular);
    if (!simular)
      await registrar(req, { acao: "upvendas.enviar", entidade: "produto", resumo: `Envio ao UP: ${resultados.filter((r) => r.ok).length} ok, ${resultados.filter((r) => !r.ok).length} com erro` });
    return ok({ resultados });
  } catch (e) {
    return erro(e, 502);
  }
}
