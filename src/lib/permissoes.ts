import "server-only";
import { getConfig } from "./config";
import { SemPermissao, usuarioDaRequisicao } from "./auth";
import { registrar } from "./historico";
import { brl, fatorAbaixoDoMinimo, precoManualAbaixoDoMinimo } from "./precos";

/**
 * Fator mínimo da loja (precificacao.json → fator_minimo) em todo caminho que grava preço:
 * pedido (POST/PATCH), produto (POST/PATCH), lote e importação da skill.
 *  - Funcionária: fator (ou preço manual) abaixo do mínimo → 403 com a mensagem para a tela.
 *  - Gestora: pode; a peça fica com alerta (recálculo) e a rota registra no histórico (registrarAbaixoDoMinimo).
 */
export interface ChecagemMinimo {
  abaixo: boolean; // abaixo do mínimo (só chega aqui como true para a gestora)
  minimo: number;
  fatorEfetivo?: number | null;
}

const fmt = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

export async function ehGestora(req: Request) {
  const u = await usuarioDaRequisicao(req);
  return u?.p === "gestora";
}

/** Fator escolhido (antes do arredondamento) abaixo do mínimo: só a gestora. */
export async function checarFator(req: Request, fator: number | null | undefined): Promise<ChecagemMinimo> {
  const pol = await getConfig("precificacao");
  const minimo = Number(pol.fator_minimo ?? 0);
  if (!fatorAbaixoDoMinimo(fator, pol)) return { abaixo: false, minimo };
  if (!(await ehGestora(req)))
    throw new SemPermissao(`Fator ×${fmt(fator)} abaixo do mínimo da loja (×${fmt(minimo)}). Somente a gestora pode usar um fator menor.`);
  return { abaixo: true, minimo };
}

/**
 * Preço fixado à mão: fator efetivo = preço ÷ custo (com a tolerância da escada). Sem custo ainda (0/desconhecido),
 * não dá para conferir aqui: o recálculo confere quando o custo chegar e alerta "Preço manual abaixo do fator mínimo".
 */
export async function checarPrecoManual(req: Request, preco: number | null | undefined, custo: number | null | undefined): Promise<ChecagemMinimo> {
  const pol = await getConfig("precificacao");
  const minimo = Number(pol.fator_minimo ?? 0);
  const m = precoManualAbaixoDoMinimo(preco, custo, pol);
  if (!m.abaixo) return { abaixo: false, minimo, fatorEfetivo: m.fatorEfetivo };
  if (!(await ehGestora(req)))
    throw new SemPermissao(
      `O preço ${brl(preco)} dá fator ×${fmt(m.fatorEfetivo)}, abaixo do mínimo da loja (×${fmt(minimo)}; pelo menos ${brl(m.precoMinimo)}). Somente a gestora pode usar esse preço.`,
    );
  return { abaixo: true, minimo, fatorEfetivo: m.fatorEfetivo };
}

/** Histórico: a gestora usou fator/preço abaixo do mínimo. */
export async function registrarAbaixoDoMinimo(
  req: Request | null,
  dados: { entidade: "pedido" | "produto"; entidadeId: string | null; resumo: string; dados?: Record<string, unknown> },
  quem?: { u: string | null; n: string },
) {
  await registrar(req, { acao: "preco.abaixo_minimo", entidade: dados.entidade, entidadeId: dados.entidadeId, resumo: dados.resumo, dados: dados.dados }, quem);
}
