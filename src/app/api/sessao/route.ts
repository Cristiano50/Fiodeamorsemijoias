import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { modoAcesso, usuarioDaRequisicao } from "@/lib/auth";

/** Modo de acesso e usuário atual (usado pelo menu, pela tela de entrada e pelo proxy). */
export async function GET(req: NextRequest) {
  try {
    const modo = await modoAcesso();
    if (req.nextUrl.searchParams.get("modo")) return ok({ modo });
    const u = await usuarioDaRequisicao(req);
    return ok({ modo, usuario: u ? { id: u.u, nome: u.n, papel: u.p } : null });
  } catch (e) {
    return erro(e);
  }
}
