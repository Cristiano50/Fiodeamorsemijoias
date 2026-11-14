import "server-only";
import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { IaIndisponivel } from "./ai/claude";
import { SemPermissao } from "./auth";
import { LimiteIaAtingido } from "./gastos";

/** Resposta JSON de erro padronizada, com mensagens em português. */
export function erro(e: unknown, status = 500) {
  let msg = e instanceof Error ? e.message : String(e);
  let codigo = status;
  if (e instanceof IaIndisponivel) codigo = 412;
  else if (e instanceof SemPermissao) codigo = 403;
  else if (e instanceof LimiteIaAtingido) codigo = 429;
  else if (e instanceof Anthropic.AuthenticationError) {
    codigo = 412; // não usar 401: o navegador entenderia como "sessão expirada"
    msg = "Chave da Anthropic inválida. Confira em Configurações → Integrações.";
  } else if (e instanceof Anthropic.RateLimitError) {
    codigo = 429;
    msg = "Limite de uso da IA atingido. Aguarde um minuto e tente de novo.";
  } else if (e instanceof Anthropic.APIError) {
    msg = `Erro da IA (${e.status}): ${e.message}`;
  }
  console.error("[api]", msg);
  return NextResponse.json({ erro: msg }, { status: codigo });
}

export const ok = (dados: unknown = { ok: true }) => NextResponse.json(dados);
