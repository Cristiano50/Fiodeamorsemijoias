import { NextRequest } from "next/server";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { lerPlanilha } from "@/lib/vendas";
import { CodigoEmUso, definirCodigoBarras } from "@/lib/servicos";
import { CAMPOS_CODIGOS_UP, casarCodigosUp, lerLinhasCodigos, sugerirMapeamentoCodigos, type MapeamentoCodigos } from "@/lib/codigos-up";
import { textoCelula } from "@/lib/vendas-calculo";

export const maxDuration = 120;

function lerMapeamento(bruto: string | null): MapeamentoCodigos | null {
  if (!bruto) return null;
  const obj = JSON.parse(bruto) as Record<string, unknown>;
  const mapa: MapeamentoCodigos = {};
  for (const c of CAMPOS_CODIGOS_UP) {
    const n = Number(obj[c.id]);
    if (obj[c.id] !== null && obj[c.id] !== "" && Number.isInteger(n) && n >= 0) mapa[c.id] = n;
  }
  return mapa;
}

/**
 * POST /api/upvendas/codigos (multipart)
 *  - arquivo: lista de produtos exportada do UP Vendas (CSV ou XLSX) com referência e código de barras
 *  - mapeamento: JSON { campo: índice da coluna } (opcional; sem ele o app sugere pelos cabeçalhos)
 *  - aplicar: "1" grava os códigos; sem ele, só mostra a prévia
 * O código do UP vai para o produto e para as recompras dele.
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro("Envie a lista de produtos exportada do UP Vendas (CSV ou XLSX).", 400);
    const planilha = await lerPlanilha(arquivo);
    let mapeamento: MapeamentoCodigos;
    try {
      mapeamento = lerMapeamento(form.get("mapeamento") as string | null) ?? sugerirMapeamentoCodigos(planilha.cabecalhos);
    } catch {
      return erro("Mapeamento inválido.", 400);
    }
    const base = {
      arquivoNome: arquivo.name,
      cabecalhos: planilha.cabecalhos,
      mapeamento,
      campos: CAMPOS_CODIGOS_UP,
      amostra: planilha.linhas.slice(0, 6).map((l) => planilha.cabecalhos.map((_, i) => textoCelula(l[i]))),
    };
    if (mapeamento.referencia == null || mapeamento.codigoBarras == null) return ok({ ...base, resultado: null, faltaColuna: true });

    const { lidas, ignoradas } = lerLinhasCodigos(planilha.linhas, mapeamento, planilha.linhaCabecalho + 1);
    const db = await getDb();
    const p = schema.produtos;
    const produtos = await db
      .select({
        id: p.id,
        referencia: p.referencia,
        codigoFornecedor: p.codigoFornecedor,
        variacao: p.variacao,
        nome: p.nome,
        codigoBarras: p.codigoBarras,
        codigoBarrasOrigem: p.codigoBarrasOrigem,
        recompraDe: p.recompraDe,
      })
      .from(p);
    const resultado = casarCodigosUp(produtos, lidas, ignoradas);

    if (form.get("aplicar") !== "1") return ok({ ...base, resultado, aplicados: 0 });

    let aplicados = 0;
    const falhas: string[] = [];
    for (const a of resultado.atualizar) {
      try {
        await definirCodigoBarras(a.produtoId, a.depois, "up");
        aplicados++;
      } catch (e) {
        falhas.push(`${a.referencia}${a.variacao ? ` ${a.variacao}` : ""}: ${e instanceof CodigoEmUso ? e.message : String(e)}`);
      }
    }
    if (aplicados)
      await registrar(req, {
        acao: "codigos_up.importar",
        entidade: "produto",
        resumo: `Códigos de barras do UP importados de "${arquivo.name}": ${aplicados} produto(s) atualizado(s)`,
        dados: { mudancas: resultado.atualizar.slice(0, 300).map((a) => ({ referencia: a.referencia, variacao: a.variacao, antes: a.antes, depois: a.depois })) },
      });
    return ok({ ...base, resultado, aplicados, falhas });
  } catch (e) {
    return erro(e, 400);
  }
}
