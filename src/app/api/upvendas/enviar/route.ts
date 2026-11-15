import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { enviarProdutos } from "@/lib/upvendas";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { urlDoApp } from "@/lib/url";

export const maxDuration = 300;

/**
 * Corpo: { ids: string[], simular?: boolean }
 * Só os produtos novos são criados no UP (saldo = o que entrou na conferência). Recompras voltam com
 * `recompra: true` e não são enviadas: a entrada de estoque delas vai pela planilha de recompras.
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const corpo = (await req.json().catch(() => ({}))) as { ids?: unknown; simular?: unknown };
    const ids = Array.isArray(corpo.ids) ? [...new Set(corpo.ids.filter((x): x is string => typeof x === "string" && !!x))] : [];
    if (!ids.length) return erro("Selecione os produtos", 400);
    if (ids.length > 2000) return erro("Envie no máximo 2.000 produtos por vez.", 400);
    const simular = corpo.simular === true;
    const resultados = await enviarProdutos(ids, await urlDoApp(req), simular);
    if (!simular) {
      const enviados = resultados.filter((r) => r.ok).length;
      const recompras = resultados.filter((r) => r.recompra).length;
      const comErro = resultados.length - enviados - recompras;
      await registrar(req, {
        acao: "upvendas.enviar",
        entidade: "produto",
        resumo: `Envio ao UP: ${enviados} ok, ${comErro} com erro${recompras ? `, ${recompras} recompra(s) fora do envio (entrada pela planilha de recompras)` : ""}`,
      });
    }
    return ok({ resultados });
  } catch (e) {
    return erro(e, 502);
  }
}
