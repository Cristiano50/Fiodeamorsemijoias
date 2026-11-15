/**
 * Custo verdadeiro do pedido (item 27 da revisão).
 *  - cotação efetiva = R$ realmente pagos ÷ (total do pedido na moeda − créditos abatidos neste pedido);
 *  - ao aplicar, a PTAX fica guardada em pedidos.cotacaoPtax e o pedido passa a usar a efetiva;
 *  - perdas/defeitos (%) e embalagem/etiqueta (R$ por peça) por pedido, em pedidos.custos;
 *  - "Pagou imposto na chegada?" troca o cenário mercadoria_frete ↔ rts_courier_cnpj.
 *
 * Funções puras (sem banco e sem "server-only"), testadas em tests/operacao-custo-real.test.ts.
 */
import { lerNumeroBr } from "./numeros";

export const CENARIO_SEM_IMPOSTO = "mercadoria_frete";
export const CENARIO_COM_IMPOSTO = "rts_courier_cnpj";

/** Componentes de custo que o quadro "Custo verdadeiro" edita (src/config/fiscal.json). */
export const COMPONENTE_PERDAS = "perdas_defeitos";
export const COMPONENTE_EMBALAGEM = "embalagem_etiqueta";
/** Com a cotação efetiva, o spread e o IOF já estão no valor pago (orientação do contador: "zere se usar a cotação efetiva"). */
export const COMPONENTES_DO_CAMBIO = ["spread_cambio", "iof_cambio"] as const;

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Cotação efetiva (R$ por 1 unidade da moeda), ou null quando não dá para calcular (compra em reais, sem pagamento…). */
export function cotacaoEfetiva(a: { moeda: string; valorPagoBrl: number | null | undefined; totalMoeda: number; abatidosMoeda?: number | null }): number | null {
  if (a.moeda === "BRL") return null;
  const pago = Number(a.valorPagoBrl);
  if (!(pago > 0)) return null;
  const base = r2((Number(a.totalMoeda) || 0) - (Number(a.abatidosMoeda) || 0));
  if (!(base > 0)) return null;
  return r6(pago / base);
}

/** PTAX × efetiva: diferença em % e em R$ sobre o que foi pago na moeda. */
export function comparativoCotacao(a: { ptax: number | null | undefined; efetiva: number | null | undefined; baseMoeda: number }) {
  const ptax = Number(a.ptax);
  const efetiva = Number(a.efetiva);
  if (!(ptax > 0) || !(efetiva > 0)) return { diferencaPct: null, diferencaBrl: null };
  return { diferencaPct: r2((efetiva / ptax - 1) * 100), diferencaBrl: r2((efetiva - ptax) * (Number(a.baseMoeda) || 0)) };
}

export type EstadoEfetiva =
  | "compra_em_reais" // pedido em R$: não há cotação a ajustar
  | "sem_pagamento" // falta informar o valor pago
  | "sem_base" // total do pedido (menos créditos) zerado
  | "nao_aplicada" // dá para aplicar
  | "aplicada" // o pedido usa a cotação efetiva
  | "desatualizada"; // aplicada antes, mas o valor pago, o total ou os créditos mudaram (ou a cotação foi trocada à mão)

/** A PTAX guardada indica que a cotação efetiva foi aplicada (é ela que "Voltar para a PTAX" devolve). */
export function estadoEfetiva(p: { moeda: string; cotacao: number; cotacaoPtax: number | null | undefined }, efetiva: number | null): EstadoEfetiva {
  if (p.moeda === "BRL") return "compra_em_reais";
  const aplicadaAntes = p.cotacaoPtax != null;
  if (efetiva == null) return aplicadaAntes ? "desatualizada" : "sem_pagamento";
  if (!aplicadaAntes) return "nao_aplicada";
  return Math.abs(p.cotacao - efetiva) <= 1e-6 ? "aplicada" : "desatualizada";
}

/** Ao aplicar a cotação efetiva: o spread e o IOF passam a zero no pedido (já estão no valor pago). */
export function custosComEfetiva(custos: Record<string, number> | null | undefined): Record<string, number> {
  const out = { ...(custos ?? {}) };
  for (const k of COMPONENTES_DO_CAMBIO) out[k] = 0;
  return out;
}

/** Ao voltar para a PTAX: tira os zeros que a cotação efetiva colocou (o spread e o IOF voltam a ser os do cenário). */
export function custosSemEfetiva(custos: Record<string, number> | null | undefined): Record<string, number> | null {
  const out = { ...(custos ?? {}) };
  for (const k of COMPONENTES_DO_CAMBIO) if (out[k] === 0) delete out[k];
  return Object.keys(out).length ? out : null;
}

/**
 * Custos do pedido ao trocar o cenário pela chave "Pagou imposto na chegada?":
 * os valores passam a ser os do cenário novo, mas o pedido guarda o frete digitado, as perdas e a embalagem
 * (valores em vigor) e, com a cotação efetiva, o spread e o IOF zerados.
 */
export function custosNaTrocaDeCenario(
  atuais: Record<string, number> | null | undefined,
  emVigor: Record<string, number>,
  efetivaAplicada: boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (atuais?.frete_internacional != null) out.frete_internacional = Number(atuais.frete_internacional) || 0;
  out[COMPONENTE_PERDAS] = Number(emVigor[COMPONENTE_PERDAS]) || 0;
  out[COMPONENTE_EMBALAGEM] = Number(emVigor[COMPONENTE_EMBALAGEM]) || 0;
  return efetivaAplicada ? custosComEfetiva(out) : out;
}

/** O cenário cobra imposto de importação na chegada (II ou ICMS maior que zero)? */
export function cenarioComImposto(cenario: { valores?: Record<string, number> } | null | undefined): boolean {
  const v = cenario?.valores ?? {};
  return (Number(v.imposto_importacao) || 0) > 0 || (Number(v.icms_importacao) || 0) > 0;
}

/* -------------------------------------------------- valores digitados na tela */

/** Valor em R$ (aceita "1.234,56"); vazio → null; inválido → undefined. */
export function lerValorPago(v: unknown): number | null | undefined {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = lerNumeroBr(v);
  return n != null && n > 0 && n < 100_000_000 ? r2(n) : undefined;
}

/** Percentual de 0 a 100 (aceita "2,5"); vazio → null; inválido → undefined. */
export function lerPercentual(v: unknown): number | null | undefined {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = lerNumeroBr(v, { milhar: false });
  return n != null && n >= 0 && n <= 100 ? Math.round(n * 1000) / 1000 : undefined;
}

/** R$ por peça de 0 a 1.000; vazio → null; inválido → undefined. */
export function lerValorPorPeca(v: unknown): number | null | undefined {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = lerNumeroBr(v, { milhar: false });
  return n != null && n >= 0 && n <= 1000 ? r2(n) : undefined;
}
