import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { aguardandoRecompra, agruparVariacoesAutomaticas, detectarRecompras, gerarCodigos, produtosDoPedido, recalcularPedido } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Gera referência (+ EAN-13 no modo "app") para os itens do pedido que ainda não têm. Corpo: { ids?, refazer? }
 * Antes de criar referências, roda de novo a recompra e o agrupamento de variações (recompra herda a do original;
 * recompra a confirmar espera a decisão). `refazer` troca as referências já criadas: só a gestora, com histórico.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; refazer?: boolean };
    if (body.refazer) await exigirPapel(req, "gestora");
    const recompras = await detectarRecompras(id);
    await agruparVariacoesAutomaticas(id);
    if (recompras) await recalcularPedido(id);
    const produtos = await produtosDoPedido(id);
    const ids = body.ids?.length ? body.ids : produtos.map((p) => p.id);
    const n = await gerarCodigos(ids, !!body.refazer);
    const aConfirmar = produtos.filter((p) => aguardandoRecompra(p) && ids.includes(p.id)).length;
    if (body.refazer)
      await registrar(req, {
        acao: "pedido.codigos_refazer",
        entidade: "pedido",
        entidadeId: id,
        resumo: `Referências${n ? "" : " (nenhuma alterada)"} refeitas em ${n} peça(s) do pedido`,
        dados: { ids: body.ids ?? null },
      });
    return ok({ gerados: n, recompras, aConfirmar });
  } catch (e) {
    return erro(e);
  }
}
