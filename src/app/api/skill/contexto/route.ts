import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { autorizarSkill, contextoSkill } from "@/lib/cadastro-skill";

/**
 * GET /api/skill/contexto — o que a skill do Claude precisa para cadastrar igual ao app:
 * regras atuais (preço, taxonomia, marca, fiscal), próximas referências e peças já cadastradas (recompra).
 * Acesso: "Authorization: Bearer <chave da skill>" ou sessão do app.
 */
export async function GET(req: NextRequest) {
  try {
    await autorizarSkill(req);
    return ok(await contextoSkill());
  } catch (e) {
    return erro(e);
  }
}
