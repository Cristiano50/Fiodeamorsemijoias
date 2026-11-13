import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { getCenarios, getComponentesCusto, getConfig, restaurarPadrao, salvarConfig } from "@/lib/config";

const PUBLICAS = ["precificacao", "taxonomia", "fiscal", "marca", "sistema", "upvendas"] as const;
const SEGREDOS = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "UPVENDAS_SENHA"] as const;

/** Configurações efetivas. Segredos nunca saem do servidor: só informamos se estão definidos. */
export async function GET() {
  try {
    const entradas = await Promise.all(PUBLICAS.map(async (k) => [k, await getConfig(k)] as const));
    const salvos = await getConfig("segredos");
    const segredos = Object.fromEntries(
      SEGREDOS.map((s) => [s, process.env[s] ? "ambiente" : salvos[s] ? "salvo" : null]),
    );
    return ok({ ...Object.fromEntries(entradas), segredos, componentesCusto: await getComponentesCusto(), cenarios: await getCenarios() });
  } catch (e) {
    return erro(e);
  }
}

/** PUT { chave, valor } — salva a sobrescrita. Para segredos, valor = { NOME: "chave" } ("" apaga). */
export async function PUT(req: NextRequest) {
  try {
    const { chave, valor } = (await req.json()) as { chave: string; valor: Record<string, unknown> };
    if (chave === "segredos") {
      const atuais = { ...(await getConfig("segredos")) };
      for (const [k, v] of Object.entries(valor)) {
        if (!(SEGREDOS as readonly string[]).includes(k)) continue;
        if (v) atuais[k] = String(v).trim();
        else delete atuais[k];
      }
      await salvarConfig("segredos", atuais);
      return ok();
    }
    if (!(PUBLICAS as readonly string[]).includes(chave)) return erro("Configuração desconhecida", 400);
    await salvarConfig(chave as (typeof PUBLICAS)[number], valor);
    return ok({ valor: await getConfig(chave as (typeof PUBLICAS)[number]) });
  } catch (e) {
    return erro(e);
  }
}

/** DELETE ?chave=precificacao — volta ao padrão definido pelos especialistas. */
export async function DELETE(req: NextRequest) {
  try {
    const chave = req.nextUrl.searchParams.get("chave") ?? "";
    if (!(PUBLICAS as readonly string[]).includes(chave)) return erro("Configuração desconhecida", 400);
    await restaurarPadrao(chave as (typeof PUBLICAS)[number]);
    return ok();
  } catch (e) {
    return erro(e);
  }
}
