import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { importarVendas, type OpcoesImportacao } from "@/lib/vendas";
import { CAMPOS_VENDA, type Mapeamento } from "@/lib/vendas-calculo";

export const maxDuration = 300;

/** Mantém só campos conhecidos com índice de coluna válido. */
function lerMapeamento(bruto: unknown): Mapeamento {
  const mapa: Mapeamento = {};
  if (!bruto || typeof bruto !== "object") return mapa;
  for (const c of CAMPOS_VENDA) {
    const v = (bruto as Record<string, unknown>)[c.id];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0) mapa[c.id] = n;
  }
  return mapa;
}

/**
 * POST /api/vendas/importar (multipart)
 *  - arquivo: a mesma planilha da prévia
 *  - mapeamento: JSON { campo: índice da coluna }
 *  - opcoes: JSON { dataPadrao?: "AAAA-MM-DD", ignorarDuplicadas?: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro("Envie a planilha exportada do UP Vendas (CSV ou XLSX).", 400);
    let mapeamento: Mapeamento;
    let opcoes: OpcoesImportacao;
    try {
      mapeamento = lerMapeamento(JSON.parse(String(form.get("mapeamento") ?? "{}")));
      opcoes = JSON.parse(String(form.get("opcoes") ?? "{}")) as OpcoesImportacao;
    } catch {
      return erro("Mapeamento inválido.", 400);
    }
    const r = await importarVendas(arquivo, mapeamento, opcoes);
    if (r.loteId) {
      await registrar(req, {
        acao: "vendas.importar",
        entidade: "lote_vendas",
        entidadeId: r.loteId,
        resumo: `Importou ${r.linhas} venda(s) de "${r.arquivoNome}" (${r.ligadas} ligadas a produtos, ${r.totalIgnoradas} ignoradas)`,
        dados: { periodoInicio: r.periodoInicio, periodoFim: r.periodoFim, mapeamento, motivos: r.motivos },
      });
    }
    return ok(r);
  } catch (e) {
    return erro(e, 400); // sem permissão continua 403 (erro() reconhece)
  }
}
