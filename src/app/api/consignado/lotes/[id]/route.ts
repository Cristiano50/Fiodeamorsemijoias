import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { excluirLoteConsignado } from "@/lib/consignado";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/consignado/lotes/:id → desfaz a importação (a planilha anterior volta a valer para as mesmas peças). Só a gestora. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const lote = await excluirLoteConsignado(id);
    if (!lote) return erro("Importação não encontrada", 404);
    await registrar(req, {
      acao: "consignado.desfazer",
      entidade: "lote_consignado",
      entidadeId: id,
      resumo: `Desfez a importação do consignado "${lote.arquivoNome ?? "planilha"}" (${lote.linhas} linha(s))`,
    });
    return ok();
  } catch (e) {
    return erro(e);
  }
}
