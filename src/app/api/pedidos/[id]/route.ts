import { NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { buscarCotacao } from "@/lib/cambio";
import { getCenarios, getComponentesCusto, getConfig } from "@/lib/config";
import { custoMudouDoPedido, custosDoPedido, produtosDoPedido, recalcularPedido, recomprasAConfirmar, resumoPedido } from "@/lib/servicos";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { checarFator, ehGestora, registrarAbaixoDoMinimo } from "@/lib/permissoes";
import { fotosModeloPorProduto } from "@/lib/fotos";
import { FONTE_EFETIVA, apelidoDe, apelidosFornecedores } from "@/lib/fornecedores";
import { lerNumeroBr } from "@/lib/numeros";
import { cenarioPadraoPara } from "@/lib/precos";
import { custosNaTrocaDeCenario, custosSemEfetiva } from "@/lib/custo-real";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const resumo = await resumoPedido(id);
    if (!resumo.pedido) return erro("Pedido não encontrado", 404);
    const db = await getDb();
    const paginas = await db.select().from(schema.paginas).where(eq(schema.paginas.pedidoId, id));
    const produtos = await produtosDoPedido(id);
    return ok({
      ...resumo,
      pedido: { ...resumo.pedido, fornecedorApelido: apelidoDe(await apelidosFornecedores(), resumo.pedido.fornecedor) },
      produtos,
      fotosModelo: await fotosModeloPorProduto(produtos.map((p) => p.id)),
      paginasPendentes: paginas.filter((p) => !p.processada).length,
      componentesCusto: await getComponentesCusto(),
      cenarios: await getCenarios(),
      // Blocos da tela: "Recompra a confirmar" e "Custo mudou" (preço vigente × calculado).
      recompraConfirmar: await recomprasAConfirmar(produtos),
      custoMudou: await custoMudouDoPedido(resumo.pedido, produtos),
      ehGestora: await ehGestora(req),
    });
  } catch (e) {
    return erro(e);
  }
}

/** Número de um campo (aceita "850,50", "0,7745"): null = vazio; undefined = inválido. */
function numeroDoCorpo(v: unknown, milhar = true): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const n = lerNumeroBr(v, { milhar });
  return n == null ? undefined : n;
}

const CAMPOS = ["numero", "fornecedor", "dataCompra", "moeda", "cotacao", "cotacaoFonte", "cenario", "custos", "rateio", "fator", "totalDocumento", "observacoes", "status"] as const;

export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json()) as Record<string, unknown>;
    // Números digitados na tela ("850,50", "0,7745", "8,5"): texto inválido não grava.
    if ("fator" in body) {
      const f = numeroDoCorpo(body.fator, false);
      if (f === undefined || (f !== null && f <= 0)) return erro(`Fator inválido: "${body.fator}". Digite um número, ex.: 10 ou 8,5.`, 400);
      body.fator = f;
    }
    if ("cotacao" in body) {
      const c = numeroDoCorpo(body.cotacao, false);
      if (c == null || c <= 0) return erro(`Cotação inválida: "${body.cotacao ?? ""}". Digite a cotação do dia, ex.: 0,7745.`, 400);
      body.cotacao = c;
    }
    if ("frete" in body) {
      const f = numeroDoCorpo(body.frete);
      if (f === undefined || (f !== null && f < 0)) return erro(`Frete inválido: "${body.frete}". Digite só o valor, ex.: 850,50.`, 400);
      body.frete = f ?? 0;
    }
    if ("totalDocumento" in body) {
      const t = numeroDoCorpo(body.totalDocumento);
      if (t === undefined) return erro(`Total do documento inválido: "${body.totalDocumento}".`, 400);
      body.totalDocumento = t;
    }
    if ("custos" in body && body.custos != null) {
      if (typeof body.custos !== "object" || Array.isArray(body.custos)) return erro("Componentes de custo inválidos.", 400);
      const custos: Record<string, number> = {};
      for (const [k, v] of Object.entries(body.custos as Record<string, unknown>)) {
        const n = numeroDoCorpo(v);
        if (n === undefined) return erro(`Valor inválido em "${k}": "${v}".`, 400);
        custos[k] = n ?? 0;
      }
      body.custos = custos;
    }
    const minimo = "fator" in body ? await checarFator(req, body.fator as number | null) : { abaixo: false, minimo: 0 };
    const set: Record<string, unknown> = {};
    for (const c of CAMPOS) if (c in body) set[c] = body[c];
    const db0 = await getDb();
    const [antes] = await db0.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!antes) return erro("Pedido não encontrado", 404);
    const sistema = await getConfig("sistema");
    const avisos: string[] = [];
    // Cotação nova (digitada à mão ou da moeda nova): a cotação efetiva deixa de valer — a PTAX guardada sai e o
    // spread e o IOF (zerados pela efetiva) voltam a ser os do cenário.
    const efetivaAntes = antes.cotacaoFonte === FONTE_EFETIVA;
    const saiDaEfetiva = efetivaAntes && ("cotacao" in body || ("moeda" in body && String(body.moeda ?? "").toUpperCase() !== antes.moeda));
    let custosBase = antes.custos ?? null;
    if (saiDaEfetiva) {
      set.cotacaoPtax = null;
      custosBase = custosSemEfetiva(antes.custos);
      if (!("custos" in body)) set.custos = custosBase;
    }
    let trocouCenario = "cenario" in body;
    if ("moeda" in body) {
      const moeda = String(body.moeda ?? "").toUpperCase();
      if (!["CNY", "BRL", "USD"].includes(moeda)) return erro(`Moeda inválida: "${body.moeda}".`, 400);
      set.moeda = moeda;
      if (moeda !== antes.moeda) {
        const data = String(body.dataCompra ?? antes.dataCompra ?? new Date().toISOString().slice(0, 10));
        // Moeda nova = cotação nova (PTAX da data da compra; real = 1, sem busca).
        if (!("cotacao" in body)) {
          if (moeda === "BRL") Object.assign(set, { cotacao: 1, cotacaoFonte: "Real (sem conversão)", cotacaoData: data });
          else {
            const r = await buscarCotacao(moeda, data, sistema.tipoCotacao);
            if (r.cotacao) Object.assign(set, { cotacao: r.cotacao.valor, cotacaoFonte: r.cotacao.fonte, cotacaoData: r.cotacao.data });
            else {
              Object.assign(set, { cotacao: 0, cotacaoFonte: null, cotacaoData: null });
              avisos.push(`Não consegui buscar a cotação do ${moeda} (${r.erros.join("; ")}). Informe a cotação: até lá os preços ficam pendentes.`);
            }
          }
        }
        // E o cenário de custo: compra em real = importador nacional; saindo do real, volta ao padrão da loja.
        if (!("cenario" in body) && (moeda === "BRL" || antes.moeda === "BRL")) {
          const { padrao, cenarios } = await getCenarios();
          const cenario = cenarioPadraoPara(moeda, cenarios, padrao);
          if (cenario !== antes.cenario) {
            set.cenario = cenario;
            trocouCenario = true;
          }
        }
      }
    }
    if (trocouCenario && !("custos" in body)) {
      // Troca de cenário (escolhida ou pela moeda): valores do cenário novo, mas o pedido guarda o frete digitado,
      // as perdas e a embalagem em vigor (e, com a cotação efetiva, o spread e o IOF zerados).
      const emVigor = await custosDoPedido({ cenario: antes.cenario, custos: custosBase });
      set.custos = custosNaTrocaDeCenario(custosBase, emVigor, efetivaAntes && !saiDaEfetiva && antes.cotacaoPtax != null);
    }
    if ("frete" in body) {
      const base = "custos" in set ? ((set.custos as Record<string, number> | null) ?? {}) : (antes.custos ?? {});
      set.custos = { ...base, frete_internacional: body.frete as number };
    }
    if ("cotacao" in body && !("cotacaoFonte" in body)) {
      set.cotacaoFonte = "Informada manualmente";
      set.cotacaoData = body.dataCompra ?? null;
    }
    const db = await getDb();
    if (Object.keys(set).length) await db.update(schema.pedidos).set(set).where(eq(schema.pedidos.id, id));
    await recalcularPedido(id);
    // Histórico das mudanças que afetam preço.
    const mudou: string[] = [];
    if ("fator" in body && body.fator !== antes.fator) mudou.push(`fator ${antes.fator ?? "padrão"} → ${body.fator ?? "padrão"}`);
    if ("frete" in body && Number(body.frete) !== (antes.custos?.frete_internacional ?? 0)) mudou.push(`frete R$ ${antes.custos?.frete_internacional ?? 0} → R$ ${body.frete}`);
    if ("cotacao" in body && body.cotacao !== antes.cotacao) mudou.push(`cotação ${antes.cotacao} → ${body.cotacao}`);
    if (saiDaEfetiva) mudou.push("a cotação efetiva deixou de valer (spread e IOF voltaram)");
    if ("cenario" in set && set.cenario !== antes.cenario) mudou.push(`cenário ${antes.cenario} → ${set.cenario}`);
    if ("custos" in body) mudou.push("componentes de custo");
    if ("moeda" in set && set.moeda !== antes.moeda) mudou.push(`moeda ${antes.moeda} → ${set.moeda}${"cotacao" in body ? "" : ` (cotação ${set.cotacao ?? antes.cotacao})`}`);
    if (mudou.length)
      await registrar(req, { acao: "pedido.alterar", entidade: "pedido", entidadeId: id, resumo: `Pedido ${antes.numero ?? id.slice(0, 8)}: ${mudou.join("; ")}`, dados: { body } });
    if (minimo.abaixo && body.fator !== antes.fator)
      await registrarAbaixoDoMinimo(req, {
        entidade: "pedido",
        entidadeId: id,
        resumo: `Pedido ${antes.numero ?? id.slice(0, 8)}: fator ×${body.fator} abaixo do mínimo da loja (×${minimo.minimo})`,
      });
    return ok({ ...(await resumoPedido(id)), avisos });
  } catch (e) {
    return erro(e);
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const db = await getDb();
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    const c = schema.creditosFornecedor;
    // Créditos com o fornecedor: os abatidos NESTE pedido voltam a ficar em aberto; os que nasceram dele
    // (em aberto ou cancelados) somem junto. Os já abatidos em outro pedido ficam (são histórico daquele pedido).
    const reabertos = await db
      .update(c)
      .set({ status: "aberto", abatidoPedidoId: null, atualizadoEm: new Date().toISOString() })
      .where(eq(c.abatidoPedidoId, id))
      .returning({ id: c.id });
    const apagados = await db
      .delete(c)
      .where(and(eq(c.pedidoId, id), inArray(c.status, ["aberto", "cancelado"])))
      .returning({ id: c.id });
    await registrar(req, {
      acao: "pedido.excluir",
      entidade: "pedido",
      entidadeId: id,
      resumo: `Pedido ${pedido?.numero ?? id.slice(0, 8)} excluído${reabertos.length ? `; ${reabertos.length} crédito(s) abatido(s) nele voltaram a ficar em aberto` : ""}${apagados.length ? `; ${apagados.length} crédito(s) dele apagado(s)` : ""}`,
    });
    const ids = (await db.select({ id: schema.produtos.id }).from(schema.produtos).where(eq(schema.produtos.pedidoId, id))).map((p) => p.id);
    if (ids.length) await db.delete(schema.imagens).where(inArray(schema.imagens.produtoId, ids));
    await db.delete(schema.imagens).where(eq(schema.imagens.pedidoId, id));
    await db.delete(schema.produtos).where(eq(schema.produtos.pedidoId, id));
    await db.delete(schema.paginas).where(eq(schema.paginas.pedidoId, id));
    await db.delete(schema.arquivos).where(eq(schema.arquivos.pedidoId, id));
    await db.delete(schema.pedidos).where(eq(schema.pedidos.id, id));
    return ok();
  } catch (e) {
    return erro(e);
  }
}
