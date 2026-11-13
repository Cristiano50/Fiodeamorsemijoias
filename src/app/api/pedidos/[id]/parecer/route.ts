import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { parecerEspecialistas } from "@/lib/ai/claude";
import { produtosDoPedido, resumoPedido } from "@/lib/servicos";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/** Parecer do comitê de especialistas (estoque, contador, administrador, marketing). */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const resumo = await resumoPedido(id);
    if (!resumo.pedido) return erro("Pedido não encontrado", 404);
    const itens = (await produtosDoPedido(id)).map((p) => ({
      linha: p.linha,
      codigo: p.codigoFornecedor,
      descricao: p.traducao ?? p.descricaoOriginal,
      tipo: p.tipo,
      material: p.material,
      banho: p.banho,
      qtd: p.quantidade,
      preco_origem: p.precoOrigem,
      custo_total_brl: p.custoTotalBrl,
      preco_venda: p.precoVenda,
      ncm: p.ncm,
      destaque: p.destaque,
      nome: p.nome,
      alertas: p.alertas,
    }));
    const { pedido, ...numeros } = resumo;
    const parecer = await parecerEspecialistas({
      pedido: {
        numero: pedido.numero,
        fornecedor: pedido.fornecedor,
        data_compra: pedido.dataCompra,
        moeda: pedido.moeda,
        cotacao: pedido.cotacao,
        cotacao_fonte: pedido.cotacaoFonte,
        custos_adicionais: pedido.custos,
      },
      numeros,
      itens,
    });
    const db = await getDb();
    await db.update(schema.pedidos).set({ parecer: { ...parecer, geradoEm: new Date().toISOString() } }).where(eq(schema.pedidos.id, id));
    return ok(parecer);
  } catch (e) {
    return erro(e);
  }
}
