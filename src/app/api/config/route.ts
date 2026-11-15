import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel, usuarioDaRequisicao } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { getCenarios, getComponentesCusto, getConfig, getPadrao, restaurarPadrao, salvarConfig } from "@/lib/config";
import { origemDe, prepararSistema, prepararUpvendas } from "@/lib/config-seguro";

const PUBLICAS = ["precificacao", "taxonomia", "fiscal", "marca", "sistema", "upvendas"] as const;
type Publica = (typeof PUBLICAS)[number];
const SEGREDOS = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "UPVENDAS_SENHA"] as const;

/** O que está salvo no banco para a chave (sem os padrões), para mesclar com o que a tela mandou. */
async function salvoNoBanco(chave: Publica): Promise<unknown> {
  const db = await getDb();
  const [linha] = await db.select().from(schema.configuracoes).where(eq(schema.configuracoes.chave, chave));
  return linha?.valor;
}

/** Sem segredos nem chaves criadas pelo servidor (a do feed só para a gestora; a da skill, em /api/skill/info). */
function paraTela(chave: Publica, valor: unknown, gestora: boolean): unknown {
  if (chave !== "sistema" && chave !== "upvendas") return valor;
  const copia = { ...(valor as Record<string, unknown>) };
  if (chave === "sistema") {
    delete copia.skillChave;
    if (!gestora) delete copia.feedChave;
  } else delete copia.senha;
  return copia;
}

/** Apaga a senha do UP salva no app (o endereço do UP mudou). Devolve se havia senha. */
async function apagarSenhaUp(): Promise<boolean> {
  const segredos = { ...(await getConfig("segredos")) };
  if (!segredos.UPVENDAS_SENHA) return false;
  delete segredos.UPVENDAS_SENHA;
  await salvarConfig("segredos", segredos);
  return true;
}

const AVISO_SENHA_UP = "O endereço do UP Vendas mudou: a senha salva foi apagada. Digite a senha do UP de novo.";

/** Configurações efetivas. Segredos nunca saem do servidor: só informamos se estão definidos. */
export async function GET(req: NextRequest) {
  try {
    const gestora = (await usuarioDaRequisicao(req))?.p === "gestora";
    const entradas = await Promise.all(PUBLICAS.map(async (k) => [k, paraTela(k, await getConfig(k), gestora)] as const));
    const salvos = await getConfig("segredos");
    const segredos = Object.fromEntries(SEGREDOS.map((s) => [s, process.env[s] ? "ambiente" : salvos[s] ? "salvo" : null]));
    return ok({ ...Object.fromEntries(entradas), segredos, componentesCusto: await getComponentesCusto(), cenarios: await getCenarios() });
  } catch (e) {
    return erro(e);
  }
}

/**
 * PUT { chave, valor } — salva a sobrescrita. Para segredos, valor = { NOME: "chave" } ("" apaga).
 * "sistema" e "upvendas" são mesclados com o que já está salvo: a tela pode mandar só o que mudou.
 */
export async function PUT(req: NextRequest) {
  try {
    const { chave, valor } = (await req.json()) as { chave: string; valor: Record<string, unknown> };
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return erro("Configuração inválida", 400);
    if (chave === "segredos") {
      await exigirPapel(req, "gestora");
      const atuais = { ...(await getConfig("segredos")) };
      for (const [k, v] of Object.entries(valor)) {
        if (!(SEGREDOS as readonly string[]).includes(k)) continue;
        if (v) atuais[k] = String(v).trim();
        else delete atuais[k];
      }
      await salvarConfig("segredos", atuais);
      await registrar(req, { acao: "config.segredos", entidade: "config", resumo: `Chaves de API alteradas: ${Object.keys(valor).join(", ")}` });
      return ok();
    }
    if (!(PUBLICAS as readonly string[]).includes(chave)) return erro("Configuração desconhecida", 400);
    await exigirPapel(req, "gestora");
    const k = chave as Publica;
    let salvar: unknown = valor;
    let aviso: string | undefined;
    let resumo = `Configuração "${k}" alterada`;
    if (k === "sistema") {
      salvar = prepararSistema(await salvoNoBanco(k), valor, await getConfig("sistema"));
      if (valor.trocarFeedChave === true) resumo += " (chave nova do feed da Meta)";
    } else if (k === "upvendas") {
      const r = prepararUpvendas(await salvoNoBanco(k), valor, await getConfig("upvendas"));
      if ("erro" in r) return erro(r.erro, 400);
      if (r.trocouEndereco) {
        if (process.env.UPVENDAS_SENHA)
          return erro("A senha do UP Vendas está definida no computador do servidor (UPVENDAS_SENHA). Para trocar o endereço do UP, apague essa variável e depois digite a senha aqui.", 400);
        // Antes de gravar o endereço novo: a senha não pode ir para outro endereço sem ser digitada de novo.
        if (await apagarSenhaUp()) {
          aviso = AVISO_SENHA_UP;
          resumo += " (endereço novo: senha salva apagada)";
        }
      }
      salvar = r.valor;
    }
    await salvarConfig(k, salvar);
    await registrar(req, { acao: `config.${k}`, entidade: "config", entidadeId: k, resumo });
    return ok({ valor: paraTela(k, await getConfig(k), true), ...(aviso ? { aviso } : {}) });
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
    const k = chave as Publica;
    const { feedChave, skillChave } = k === "sistema" ? await getConfig("sistema") : { feedChave: "", skillChave: "" };
    let senhaApagada = false;
    if (k === "upvendas" && origemDe((await getConfig("upvendas")).baseUrl) !== origemDe(getPadrao("upvendas").baseUrl)) senhaApagada = await apagarSenhaUp();
    await restaurarPadrao(k);
    if (feedChave || skillChave) await salvarConfig("sistema", { feedChave, skillChave }); // mantém o link da Meta e a chave da skill
    await registrar(req, {
      acao: `config.${k}.padrao`,
      entidade: "config",
      entidadeId: k,
      resumo: `Configuração "${k}" voltou ao padrão${senhaApagada ? " (senha do UP apagada)" : ""}`,
    });
    return ok(senhaApagada ? { ok: true, aviso: AVISO_SENHA_UP } : { ok: true });
  } catch (e) {
    return erro(e);
  }
}
