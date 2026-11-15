import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { creditosDoFornecedor, creditosParaPedido } from "@/lib/fornecedores";

/**
 * Créditos com o fornecedor (falta e defeito da conferência). Só a gestora.
 *  GET ?pedido=ID       → { pedido, disponiveis, abatidos, gerados, totalAbatido } para a tela do pedido
 *  GET ?fornecedor=NOME → { creditos } de um fornecedor (nome original ou a chave), para /fornecedores
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const p = req.nextUrl.searchParams;
    const pedido = p.get("pedido");
    if (pedido) {
      const dados = await creditosParaPedido(pedido);
      if (!dados) return erro("Pedido não encontrado", 404);
      return ok(dados);
    }
    const fornecedor = p.get("fornecedor");
    if (fornecedor?.trim()) return ok({ creditos: await creditosDoFornecedor(fornecedor) });
    return erro("Informe o pedido ou o fornecedor.", 400);
  } catch (e) {
    return erro(e);
  }
}
