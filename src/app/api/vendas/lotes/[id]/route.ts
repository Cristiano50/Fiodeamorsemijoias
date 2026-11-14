import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { excluirLote } from "@/lib/vendas";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/vendas/lotes/:id → desfaz a importação (apaga as vendas do lote). Só a gestora. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const lote = await excluirLote(id);
    if (!lote) return erro("Lote não encontrado", 404);
    await registrar(req, {
      acao: "vendas.desfazer",
      entidade: "lote_vendas",
      entidadeId: id,
      resumo: `Desfez a importação de "${lote.arquivoNome ?? "planilha"}" (${lote.linhas} venda(s))`,
      dados: { periodoInicio: lote.periodoInicio, periodoFim: lote.periodoFim },
    });
    return ok();
  } catch (e) {
    return erro(e);
  }
}
