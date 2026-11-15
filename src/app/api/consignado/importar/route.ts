import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { importarConsignado, lerMapeamentoConsignado, type OpcoesConsignado } from "@/lib/consignado";
import type { MapeamentoConsignado } from "@/lib/consignado-calculo";

export const maxDuration = 300;

/**
 * POST /api/consignado/importar (multipart)
 *  - arquivo: a mesma planilha da prévia
 *  - mapeamento: JSON { campo: índice da coluna }
 *  - opcoes: JSON { simular?: boolean, revendedoraPadrao?: string, dataPadrao?: "AAAA-MM-DD" }
 * Com simular, só confere e devolve o resumo (nada é gravado).
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro("Envie a planilha de consignado (maletas) exportada do UP Vendas (CSV ou XLSX).", 400);
    let mapeamento: MapeamentoConsignado;
    let opcoes: OpcoesConsignado;
    try {
      mapeamento = lerMapeamentoConsignado(JSON.parse(String(form.get("mapeamento") ?? "{}")));
      const bruto = JSON.parse(String(form.get("opcoes") ?? "{}")) as Record<string, unknown>;
      opcoes = {
        simular: bruto.simular === true,
        revendedoraPadrao: typeof bruto.revendedoraPadrao === "string" ? bruto.revendedoraPadrao : null,
        dataPadrao: typeof bruto.dataPadrao === "string" ? bruto.dataPadrao : null,
      };
    } catch {
      return erro("Mapeamento inválido.", 400);
    }
    const r = await importarConsignado(arquivo, mapeamento, opcoes);
    if (r.loteId) {
      await registrar(req, {
        acao: "consignado.importar",
        entidade: "lote_consignado",
        entidadeId: r.loteId,
        resumo: `Importou o consignado de "${r.arquivoNome}": ${r.linhas} linha(s) de ${r.revendedoras} revendedora(s) (${r.ligadas} ligadas a produtos, ${r.totalIgnoradas} ignoradas)`,
        dados: { porSituacao: r.porSituacao, mapeamento, motivos: r.motivos },
      });
    }
    return ok(r);
  } catch (e) {
    return erro(e, 400); // sem permissão continua 403 (erro() reconhece)
  }
}
