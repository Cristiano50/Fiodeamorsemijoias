import "server-only";
import { gte, sum } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig } from "./config";

export type Finalidade = "analise" | "deteccao" | "parecer" | "textos" | "foto" | "avaliacao_foto";
export interface ContextoGasto {
  pedidoId?: string | null;
  produtoId?: string | null;
}

export class LimiteIaAtingido extends Error {}

const inicioDoMes = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export async function gastoDoMes(): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ total: sum(schema.gastosIa.custoUsd) }).from(schema.gastosIa).where(gte(schema.gastosIa.criadoEm, inicioDoMes()));
  return Number(r?.total ?? 0);
}

/** Antes de cada chamada de IA: respeita o limite mensal (Configurações → Integrações). */
export async function checarLimiteIa() {
  const sistema = await getConfig("sistema");
  const limite = Number(sistema.limiteMensalIaUsd ?? 0);
  if (!limite) return;
  const gasto = await gastoDoMes();
  if (gasto >= limite)
    throw new LimiteIaAtingido(`Limite mensal de gastos com IA atingido (US$ ${gasto.toFixed(2)} de US$ ${limite.toFixed(2)}). A gestora pode aumentar em Configurações.`);
}

/** Registra o uso e calcula o custo estimado pela tabela de preços (Configurações → Integrações). */
export async function registrarGasto(g: {
  servico: "anthropic" | "gemini" | "openai";
  modelo: string;
  finalidade: Finalidade;
  ctx?: ContextoGasto;
  tokensEntrada?: number;
  tokensSaida?: number;
  imagens?: number;
}) {
  try {
    const sistema = await getConfig("sistema");
    const tabela = sistema.precosIa ?? {};
    const preco = tabela[g.modelo] ?? Object.entries(tabela).find(([k]) => g.modelo.startsWith(k))?.[1] ?? {};
    const entrada = g.tokensEntrada ?? 0;
    const saida = g.tokensSaida ?? 0;
    let custo = (entrada * (preco.entradaPorMilhao ?? 0) + saida * (preco.saidaPorMilhao ?? 0)) / 1_000_000;
    // Sem contagem de tokens da imagem: usa o preço por imagem.
    if (g.imagens && !saida && preco.porImagem) custo += g.imagens * preco.porImagem;
    const db = await getDb();
    await db.insert(schema.gastosIa).values({
      servico: g.servico,
      modelo: g.modelo,
      finalidade: g.finalidade,
      pedidoId: g.ctx?.pedidoId ?? null,
      produtoId: g.ctx?.produtoId ?? null,
      tokensEntrada: entrada,
      tokensSaida: saida,
      imagens: g.imagens ?? 0,
      custoUsd: Math.round(custo * 1_000_000) / 1_000_000,
    });
  } catch (e) {
    console.error("[gastos]", e);
  }
}
