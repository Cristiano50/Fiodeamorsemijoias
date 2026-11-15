import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { testarConexao } from "@/lib/upvendas";

/** Testa o login no UP Vendas com a senha salva (só a gestora; fica no histórico). */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
  } catch (e) {
    return erro(e);
  }
  try {
    const r = await testarConexao();
    await registrar(req, { acao: "upvendas.testar", entidade: "config", entidadeId: "upvendas", resumo: "Teste de conexão com o UP Vendas: ok" });
    return ok(r);
  } catch (e) {
    await registrar(req, {
      acao: "upvendas.testar",
      entidade: "config",
      entidadeId: "upvendas",
      resumo: `Teste de conexão com o UP Vendas falhou: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
    });
    return erro(e, 502);
  }
}
