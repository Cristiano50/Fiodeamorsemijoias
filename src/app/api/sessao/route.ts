import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { modoAcesso, usuarioDaRequisicao } from "@/lib/auth";
import { ehLocal } from "@/lib/rede";
import { SENHA_MINIMA } from "@/lib/sessao";

/**
 * Modo de acesso e usuário atual (usado pelo menu, pela tela de entrada e pelo proxy, que confere o
 * login por aqui). `local`: a requisição veio do próprio computador do servidor (no acesso livre, só
 * ele entra). Nunca devolve a chave das sessões nem dados do cookie além de quem está logado.
 */
export async function GET(req: NextRequest) {
  try {
    const modo = await modoAcesso();
    const local = ehLocal(req.headers);
    if (req.nextUrl.searchParams.get("modo")) return ok({ modo, local });
    const u = await usuarioDaRequisicao(req);
    const avisos: string[] = [];
    if (u?.p === "gestora" && modo === "senha" && (process.env.APP_SENHA ?? "").length < SENHA_MINIMA)
      avisos.push(`A senha da equipe (APP_SENHA) tem menos de ${SENHA_MINIMA} caracteres: troque por uma mais longa no computador do servidor.`);
    return ok({ modo, local, usuario: u ? { id: u.u, nome: u.n, papel: u.p } : null, avisos });
  } catch (e) {
    return erro(e);
  }
}
