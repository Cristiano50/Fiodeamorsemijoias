import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { getCenarios, getComponentesCusto, getConfig, restaurarPadrao, salvarConfig } from "@/lib/config";

const PUBLICAS = ["precificacao", "taxonomia", "fiscal", "marca", "sistema", "upvendas"] as const;
const SEGREDOS = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "UPVENDAS_SENHA"] as const;

/** Configurações efetivas. Segredos nunca saem do servidor: só informamos se estão definidos. */
export async function GET() {
  try {
    const entradas = await Promise.all(
      PUBLICAS.map(async (k) => {
        const valor = await getConfig(k);
        // A chave da skill do Claude não sai por aqui (a gestora vê em /api/skill/info).
        if (k === "sistema") return [k, { ...valor, skillChave: undefined }] as const;
        return [k, valor] as const;
      }),
    );
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
      await exigirPapel(req, "gestora");
      await salvarConfig("segredos", atuais);
      await registrar(req, { acao: "config.segredos", entidade: "config", resumo: `Chaves de API alteradas: ${Object.keys(valor).join(", ")}` });
      return ok();
    }
    if (!(PUBLICAS as readonly string[]).includes(chave)) return erro("Configuração desconhecida", 400);
    await exigirPapel(req, "gestora");
    if (chave === "sistema") {
      // A chave do feed da Meta é criada pelo servidor; telas que salvam o "sistema" inteiro
      // com dados antigos não podem apagá-la (o link cadastrado na Meta pararia de funcionar).
      const { feedChave, skillChave } = await getConfig("sistema");
      if (feedChave && !valor.feedChave) valor.feedChave = feedChave;
      if (skillChave && !valor.skillChave) valor.skillChave = skillChave; // chave da skill do Claude, idem
    }
    await salvarConfig(chave as (typeof PUBLICAS)[number], valor);
    await registrar(req, { acao: `config.${chave}`, entidade: "config", entidadeId: chave, resumo: `Configuração "${chave}" alterada` });
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
    await exigirPapel(req, "gestora");
    const { feedChave, skillChave } = chave === "sistema" ? await getConfig("sistema") : { feedChave: "", skillChave: "" };
    await restaurarPadrao(chave as (typeof PUBLICAS)[number]);
    if (feedChave || skillChave) await salvarConfig("sistema", { feedChave, skillChave }); // mantém o link da Meta e a chave da skill
    await registrar(req, { acao: `config.${chave}.padrao`, entidade: "config", entidadeId: chave, resumo: `Configuração "${chave}" voltou ao padrão` });
    return ok();
  } catch (e) {
    return erro(e);
  }
}
