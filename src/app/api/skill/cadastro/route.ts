import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { autorizarSkill, importarCadastro, type PacoteCadastro } from "@/lib/cadastro-skill";
import { urlDoApp } from "@/lib/url";

export const maxDuration = 300;

/**
 * POST /api/skill/cadastro — importa o cadastro feito na skill do Claude (JSON do formato "fiodeamor-cadastro").
 * Pode vir em partes ({ parte, partes, totalItens }) por causa do limite de tamanho da nuvem; a última conclui
 * (recompra, referências, preços). Reenviar não duplica.
 * Acesso: "Authorization: Bearer <chave da skill>" ou sessão do app (botão "Importar cadastro do Claude").
 */
export async function POST(req: NextRequest) {
  try {
    const quem = await autorizarSkill(req);
    let pacote: PacoteCadastro;
    try {
      pacote = (await req.json()) as PacoteCadastro;
    } catch {
      return erro("O corpo não é um JSON válido.", 400);
    }
    const r = await importarCadastro(pacote, req, quem);
    return ok({ ...r, url: `${urlDoApp(req)}/pedidos/${r.pedidoId}` });
  } catch (e) {
    return erro(e, 400);
  }
}
