import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { getCenarios, getConfig } from "@/lib/config";
import { custosDoPedido, recalcularPedido, resumoPedido } from "@/lib/servicos";
import { FONTE_EFETIVA, FONTE_PTAX_GUARDADA, basePagamento, reaplicarCotacaoEfetiva } from "@/lib/fornecedores";
import {
  CENARIO_COM_IMPOSTO,
  CENARIO_SEM_IMPOSTO,
  COMPONENTE_EMBALAGEM,
  COMPONENTE_PERDAS,
  cenarioComImposto,
  comparativoCotacao,
  cotacaoEfetiva,
  custosComEfetiva,
  custosNaTrocaDeCenario,
  custosSemEfetiva,
  estadoEfetiva,
  lerPercentual,
  lerValorPago,
  lerValorPorPeca,
} from "@/lib/custo-real";
import { dataBr, dataValida } from "@/lib/recebimento";

type Ctx = { params: Promise<{ id: string }> };
type Pedido = typeof schema.pedidos.$inferSelect;

/**
 * Custo verdadeiro do pedido (item 27). Só a gestora.
 *  GET   → valor pago, PTAX × cotação efetiva, perdas, embalagem e se pagou imposto na chegada.
 *  PATCH → { pagoEm?, valorPagoBrl?, aplicarEfetiva?: true, voltarPtax?: true,
 *            perdasPct?: number | null, embalagemPorPeca?: number | null, impostoNaChegada?: boolean }
 *          (perdas/embalagem null = volta ao padrão da loja). Recalcula os preços quando o custo muda.
 */

/** A cotação efetiva está em uso: a fonte diz e a PTAX está guardada. */
const efetivaEmUso = (p: Pedido) => p.cotacaoFonte === FONTE_EFETIVA && p.cotacaoPtax != null;

async function estadoPagamento(id: string) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
  if (!pedido) return null;
  const [{ totalMoeda, abatidosMoeda }, emVigor, { padrao, cenarios }, sistema, resumo] = await Promise.all([
    basePagamento(id, pedido.moeda),
    custosDoPedido(pedido),
    getCenarios(),
    getConfig("sistema"),
    resumoPedido(id),
  ]);
  const efetiva = cotacaoEfetiva({ moeda: pedido.moeda, valorPagoBrl: pedido.valorPagoBrl, totalMoeda, abatidosMoeda });
  const emUso = efetivaEmUso(pedido);
  const ptax = emUso ? pedido.cotacaoPtax! : pedido.cotacao;
  const baseMoeda = Math.round((totalMoeda - abatidosMoeda) * 100) / 100;
  const cenarioId = pedido.cenario && cenarios[pedido.cenario] ? pedido.cenario : padrao;
  return {
    pedido: {
      id: pedido.id,
      numero: pedido.numero,
      moeda: pedido.moeda,
      cotacao: pedido.cotacao,
      cotacaoFonte: pedido.cotacaoFonte,
      cotacaoData: pedido.cotacaoData,
      pagoEm: pedido.pagoEm,
      valorPagoBrl: pedido.valorPagoBrl,
    },
    totalMoeda,
    abatidosMoeda,
    baseMoeda,
    ptax,
    efetiva,
    estado: estadoEfetiva({ moeda: pedido.moeda, cotacao: pedido.cotacao, cotacaoPtax: emUso ? pedido.cotacaoPtax : null }, efetiva),
    ...comparativoCotacao({ ptax, efetiva, baseMoeda }),
    cenario: { id: cenarioId, nome: cenarios[cenarioId]?.nome ?? cenarioId, comImposto: cenarioComImposto(cenarios[cenarioId]) },
    podeTrocarImposto: pedido.moeda !== "BRL" && !!cenarios[CENARIO_SEM_IMPOSTO] && !!cenarios[CENARIO_COM_IMPOSTO],
    nomeCenarioComImposto: cenarios[CENARIO_COM_IMPOSTO]?.nome ?? CENARIO_COM_IMPOSTO,
    perdasPct: Number(emVigor[COMPONENTE_PERDAS]) || 0,
    embalagemPorPeca: Number(emVigor[COMPONENTE_EMBALAGEM]) || 0,
    padroes: { perdasPct: Number(sistema.perdasPctPadrao) || 0, embalagemPorPeca: Number(sistema.embalagemPorPecaPadrao) || 0 },
    pecas: resumo.pecas,
    custoTotal: resumo.custoTotal,
    fatorCusto: resumo.detalheCustos?.fatorCusto ?? 1,
    linhasCusto: resumo.detalheCustos?.linhas ?? [],
  };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const e = await estadoPagamento(id);
    if (!e) return erro("Pedido não encontrado", 404);
    return ok(e);
  } catch (e) {
    return erro(e);
  }
}

const brl = (v: number | null | undefined) => (v == null ? "—" : `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const corpo = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) return erro("Dados inválidos.", 400);
    const db = await getDb();
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    const set: Partial<typeof schema.pedidos.$inferInsert> = {};
    const hist: string[] = [];
    let custos: Record<string, number> | null = pedido.custos ?? null;
    let mexeuCustos = false;
    let reaplicar = false;
    let recalcular = false;
    // PTAX guardada de uma efetiva antiga, mas a cotação foi trocada depois (botão PTAX ou digitada): não vale mais.
    if (pedido.cotacaoPtax != null && !efetivaEmUso(pedido)) set.cotacaoPtax = null;

    if ("pagoEm" in corpo) {
      const vazio = corpo.pagoEm === null || corpo.pagoEm === "";
      const d = vazio ? null : dataValida(corpo.pagoEm);
      if (!vazio && !d) return erro("Data do pagamento inválida.", 400);
      if (d !== pedido.pagoEm) {
        set.pagoEm = d;
        hist.push(`pago em ${dataBr(pedido.pagoEm) || "—"} → ${dataBr(d) || "—"}`);
      }
    }

    if ("valorPagoBrl" in corpo) {
      const v = lerValorPago(corpo.valorPagoBrl);
      if (v === undefined) return erro("Valor pago inválido: digite o total em reais, ex.: 6.543,21.", 400);
      if (v !== pedido.valorPagoBrl) {
        set.valorPagoBrl = v;
        hist.push(`valor pago ${brl(pedido.valorPagoBrl)} → ${brl(v)}`);
        reaplicar = true;
      }
    }

    if ("perdasPct" in corpo || "embalagemPorPeca" in corpo) {
      const sistema = await getConfig("sistema");
      const novo = { ...(custos ?? {}) };
      if ("perdasPct" in corpo) {
        const v = lerPercentual(corpo.perdasPct);
        if (v === undefined) return erro("Perdas e defeitos: use um percentual de 0 a 100.", 400);
        novo[COMPONENTE_PERDAS] = v ?? (Number(sistema.perdasPctPadrao) || 0);
      }
      if ("embalagemPorPeca" in corpo) {
        const v = lerValorPorPeca(corpo.embalagemPorPeca);
        if (v === undefined) return erro("Embalagem e etiqueta: use um valor em reais por peça (ex.: 0,40).", 400);
        novo[COMPONENTE_EMBALAGEM] = v ?? (Number(sistema.embalagemPorPecaPadrao) || 0);
      }
      const emVigor = await custosDoPedido({ cenario: pedido.cenario, custos });
      const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;
      if (COMPONENTE_PERDAS in novo && novo[COMPONENTE_PERDAS] !== Number(emVigor[COMPONENTE_PERDAS] ?? 0))
        hist.push(`perdas e defeitos ${pct(Number(emVigor[COMPONENTE_PERDAS] ?? 0))} → ${pct(novo[COMPONENTE_PERDAS])}`);
      if (COMPONENTE_EMBALAGEM in novo && novo[COMPONENTE_EMBALAGEM] !== Number(emVigor[COMPONENTE_EMBALAGEM] ?? 0))
        hist.push(`embalagem e etiqueta ${brl(Number(emVigor[COMPONENTE_EMBALAGEM] ?? 0))} → ${brl(novo[COMPONENTE_EMBALAGEM])} por peça`);
      custos = novo;
      mexeuCustos = true;
    }

    if ("impostoNaChegada" in corpo) {
      if (typeof corpo.impostoNaChegada !== "boolean") return erro("Responda sim ou não.", 400);
      if (pedido.moeda === "BRL") return erro("Compra em reais (nacional) não tem imposto de importação a escolher.", 400);
      const { padrao, cenarios } = await getCenarios();
      const alvo = corpo.impostoNaChegada ? CENARIO_COM_IMPOSTO : CENARIO_SEM_IMPOSTO;
      if (!cenarios[alvo]) return erro(`O cenário "${alvo}" não existe em Configurações → Câmbio e custos.`, 400);
      const atual = pedido.cenario && cenarios[pedido.cenario] ? pedido.cenario : padrao;
      if (alvo !== atual) {
        const emVigor = await custosDoPedido({ cenario: pedido.cenario, custos });
        custos = custosNaTrocaDeCenario(custos, emVigor, efetivaEmUso(pedido) && corpo.voltarPtax !== true);
        set.cenario = alvo;
        mexeuCustos = true;
        hist.push(`imposto na chegada: ${corpo.impostoNaChegada ? "sim" : "não"} (cenário ${cenarios[atual]?.nome ?? atual} → ${cenarios[alvo].nome})`);
      }
    }

    if (corpo.aplicarEfetiva === true) {
      if (pedido.moeda === "BRL") return erro("Compra em reais: não há cotação a ajustar.", 400);
      const { totalMoeda, abatidosMoeda } = await basePagamento(id, pedido.moeda);
      const valorPago = "valorPagoBrl" in set ? set.valorPagoBrl : pedido.valorPagoBrl;
      const efetiva = cotacaoEfetiva({ moeda: pedido.moeda, valorPagoBrl: valorPago, totalMoeda, abatidosMoeda });
      if (efetiva == null) return erro("Informe o valor pago (R$) para calcular a cotação efetiva.", 400);
      const ptax = efetivaEmUso(pedido) ? pedido.cotacaoPtax! : pedido.cotacao;
      set.cotacaoPtax = ptax;
      set.cotacao = efetiva;
      set.cotacaoFonte = FONTE_EFETIVA;
      set.cotacaoData = ("pagoEm" in set ? set.pagoEm : pedido.pagoEm) ?? pedido.cotacaoData;
      custos = custosComEfetiva(custos);
      mexeuCustos = true;
      reaplicar = false;
      recalcular = true;
      hist.push(`cotação efetiva ${efetiva.toLocaleString("pt-BR", { maximumFractionDigits: 6 })} aplicada (antes ${ptax.toLocaleString("pt-BR", { maximumFractionDigits: 6 })})`);
    } else if (corpo.voltarPtax === true) {
      if (!efetivaEmUso(pedido)) return erro("O pedido não está usando a cotação efetiva.", 400);
      set.cotacao = pedido.cotacaoPtax!;
      set.cotacaoPtax = null;
      set.cotacaoFonte = FONTE_PTAX_GUARDADA;
      custos = custosSemEfetiva(custos);
      mexeuCustos = true;
      reaplicar = false;
      recalcular = true;
      hist.push(`voltou para a PTAX ${pedido.cotacaoPtax!.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}`);
    }

    if (mexeuCustos) {
      set.custos = custos;
      recalcular = true;
    }
    if (Object.keys(set).length) await db.update(schema.pedidos).set(set).where(eq(schema.pedidos.id, id));
    if (reaplicar && (await reaplicarCotacaoEfetiva(id))) {
      recalcular = true;
      hist.push("cotação efetiva recalculada");
    }
    if (recalcular) await recalcularPedido(id);
    if (hist.length) await registrar(req, { acao: "pedido.pagamento", entidade: "pedido", entidadeId: id, resumo: `Pedido ${pedido.numero ?? id.slice(0, 8)}: ${hist.join("; ")}`, dados: { corpo } });
    return ok(await estadoPagamento(id));
  } catch (e) {
    return erro(e);
  }
}
