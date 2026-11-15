import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { recalcularPedido } from "@/lib/servicos";
import { ErroCredito, alterarCredito, reaplicarCotacaoEfetiva } from "@/lib/fornecedores";

type Ctx = { params: Promise<{ id: string }> };

const ACOES = ["abater", "cancelar", "reabrir"] as const;

/**
 * PATCH /api/creditos/:id { acao: "abater", pedidoId } | { acao: "cancelar" } | { acao: "reabrir" }. Só a gestora.
 *  - abater: o fornecedor descontou no pedido informado (mesmo fornecedor e mesma moeda); entra na cotação efetiva;
 *  - cancelar: o fornecedor não vai pagar este crédito;
 *  - reabrir: desfaz o abatimento ou o cancelamento.
 * Com a cotação efetiva em uso no pedido do abatimento, ela é recalculada (e os preços também).
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const corpo = (await req.json().catch(() => ({}))) as { acao?: unknown; pedidoId?: unknown };
    const acao = ACOES.find((a) => a === corpo.acao);
    if (!acao) return erro("Ação inválida: use abater, cancelar ou reabrir.", 400);
    const r = await alterarCredito(id, acao, typeof corpo.pedidoId === "string" ? corpo.pedidoId : null);
    const recalculados: string[] = [];
    for (const pid of r.pedidosAfetados) {
      if (await reaplicarCotacaoEfetiva(pid)) {
        await recalcularPedido(pid);
        recalculados.push(pid);
      }
    }
    await registrar(req, {
      acao: `credito.${acao}`,
      entidade: "credito",
      entidadeId: id,
      resumo: `${r.resumo}${recalculados.length ? " — cotação efetiva recalculada" : ""}`,
      dados: { pedidoId: r.credito.pedidoId, fornecedor: r.credito.fornecedor, pedidosAfetados: r.pedidosAfetados },
    });
    return ok({ ok: true, recalculados });
  } catch (e) {
    if (e instanceof ErroCredito) return erro(e.message, e.status);
    return erro(e);
  }
}
