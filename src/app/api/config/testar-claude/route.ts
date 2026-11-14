import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { getConfig, getSegredo } from "@/lib/config";

/**
 * POST /api/config/testar-claude (gestora) — confere a chave da Anthropic sem gastar créditos:
 * consulta o modelo configurado na API de modelos (não gera texto, não cobra tokens).
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const apiKey = await getSegredo("ANTHROPIC_API_KEY");
    if (!apiKey) return ok({ ok: false, mensagem: "Nenhuma chave do Claude salva. Cole a chave do Console da Anthropic e clique em Salvar chaves." });
    const { claudeModelo } = await getConfig("sistema");
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
    try {
      const m = await client.models.retrieve(claudeModelo);
      const origem = process.env.ANTHROPIC_API_KEY ? "variável de ambiente do servidor" : "chave salva no app";
      return ok({
        ok: true,
        mensagem: `Chave aceita (${origem}). Modelo ${m.display_name ?? m.id} disponível. Os gastos aparecem em "Gastos com IA" e no Console da Anthropic.`,
        modelo: m.id,
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return ok({ ok: false, mensagem: "A Anthropic recusou a chave (401). Confira se copiou a chave inteira (começa com sk-ant-) e se ela não foi desativada no Console." });
      if (e instanceof Anthropic.PermissionDeniedError) return ok({ ok: false, mensagem: "A chave não tem permissão para este modelo (403). Confira o workspace da chave no Console da Anthropic." });
      if (e instanceof Anthropic.NotFoundError) return ok({ ok: false, mensagem: `A chave funciona, mas o modelo "${claudeModelo}" não foi encontrado. Confira o modelo em Configurações → Integrações e IA.` });
      if (e instanceof Anthropic.RateLimitError) return ok({ ok: false, mensagem: "Limite de uso atingido na Anthropic (429). Confira os créditos e limites da conta no Console." });
      if (e instanceof Anthropic.APIConnectionError) return ok({ ok: false, mensagem: "Sem conexão com a Anthropic. Confira a internet do servidor do app." });
      throw e;
    }
  } catch (e) {
    return erro(e);
  }
}
