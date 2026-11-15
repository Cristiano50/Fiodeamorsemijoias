import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { garantirChaveSkill } from "@/lib/cadastro-skill";
import { enderecoPrivado } from "@/lib/feed-meta";
import { urlDoApp } from "@/lib/url";

/** GET /api/skill/info (gestora) — endereço do app e chave da skill (cria a chave se ainda não houver). */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const url = await urlDoApp(req);
    return ok({ url, chave: await garantirChaveSkill(), enderecoPrivado: enderecoPrivado(url), dominio: new URL(url).hostname });
  } catch (e) {
    return erro(e);
  }
}

/** POST /api/skill/info { acao: "nova" } (gestora) — troca a chave (a antiga para de funcionar). */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const { acao } = (await req.json().catch(() => ({}))) as { acao?: string };
    if (acao !== "nova") return erro("Ação desconhecida", 400);
    const chave = await garantirChaveSkill(true);
    await registrar(req, { acao: "config.skill_chave", entidade: "config", entidadeId: "sistema", resumo: "Chave da skill do Claude trocada (a anterior parou de funcionar)" });
    return ok({ chave });
  } catch (e) {
    return erro(e);
  }
}
