import { NextRequest } from "next/server";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { lerPlanilha } from "@/lib/vendas";
import { CodigoEmUso, definirCodigoBarras, especificacaoDe, gravarSaldosUp } from "@/lib/servicos";
import {
  CAMPOS_CODIGOS_UP,
  casarCodigosUp,
  lerLinhasCodigos,
  saldosDaPlanilha,
  sugerirMapeamentoCodigos,
  type MapeamentoCodigos,
} from "@/lib/codigos-up";
import { ehZip, verificarLinhas, verificarTamanho, verificarXlsx } from "@/lib/planilha-segura";
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
 *    (opcionais: código externo, grade, nome e saldo de estoque)
 *  - mapeamento: JSON { campo: índice da coluna } (opcional; sem ele o app sugere pelos cabeçalhos)
 *  - aplicar: "1" grava os códigos novos (e o saldo, se a coluna foi escolhida); sem ele, só mostra a prévia
 *  - trocar: JSON com os ids das peças cujo código do UP a gestora confirmou trocar, ou "todos"
 * O código do UP vai para o produto e para as recompras dele. Um código que já veio do UP nunca é trocado sem confirmação.
 */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro("Envie a lista de produtos exportada do UP Vendas (CSV ou XLSX).", 400);
    // Antes do exceljs: tamanho, ZIP corrompido e "zip-bomb" (planilha-segura).
    const bruto = new Uint8Array(await arquivo.arrayBuffer());
    if (ehZip(bruto)) verificarXlsx(bruto);
    else verificarTamanho(bruto.length);
    const planilha = await lerPlanilha(arquivo);
    verificarLinhas(planilha.linhas.length);
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
    const saldos = mapeamento.saldo != null ? saldosDaPlanilha(lidas) : [];
    const db = await getDb();
    const p = schema.produtos;
    const produtos = (
      await db
        .select({
          id: p.id,
          referencia: p.referencia,
          codigoFornecedor: p.codigoFornecedor,
          variacao: p.variacao,
          especificacao: p.especificacao,
          textoOriginal: p.textoOriginal,
          nome: p.nome,
          codigoBarras: p.codigoBarras,
          codigoBarrasOrigem: p.codigoBarrasOrigem,
          recompraDe: p.recompraDe,
        })
        .from(p)
    ).map(({ textoOriginal, ...x }) => ({ ...x, especificacao: especificacaoDe({ ...x, textoOriginal }) || null }));
    const resultado = casarCodigosUp(produtos, lidas, ignoradas);
    const trocas = resultado.conflitos.filter((c) => c.troca);

    if (form.get("aplicar") !== "1") return ok({ ...base, resultado, saldos: saldos.length, aplicados: 0 });

    // Trocas de código do UP: só as que a gestora confirmou (uma a uma ou todas).
    let pedidas: Set<string> | "todos" = new Set();
    const trocarBruto = form.get("trocar");
    if (typeof trocarBruto === "string" && trocarBruto) {
      try {
        const v = JSON.parse(trocarBruto) as unknown;
        pedidas = v === "todos" ? "todos" : new Set(Array.isArray(v) ? v.map(String) : []);
      } catch {
        return erro("Lista de trocas inválida.", 400);
      }
    }
    const confirmadas = trocas.filter((c) => pedidas === "todos" || pedidas.has(c.troca!.produtoId));
    if (confirmadas.length) await exigirPapel(req, "gestora");

    let aplicados = 0;
    let trocados = 0;
    const falhas: string[] = [];
    for (const a of resultado.atualizar) {
      try {
        await definirCodigoBarras(a.produtoId, a.depois, "up");
        aplicados++;
      } catch (e) {
        falhas.push(`${a.referencia}${a.variacao ? ` ${a.variacao}` : ""}: ${e instanceof CodigoEmUso ? e.message : String(e)}`);
      }
    }
    for (const c of confirmadas) {
      const t = c.troca!;
      try {
        await definirCodigoBarras(t.produtoId, t.novo, "up");
        trocados++;
      } catch (e) {
        falhas.push(`${t.referencia}${t.variacao ? ` ${t.variacao}` : ""}: ${e instanceof CodigoEmUso ? e.message : String(e)}`);
      }
    }
    const saldosGravados = await gravarSaldosUp(saldos, arquivo.name);
    if (aplicados)
      await registrar(req, {
        acao: "codigos_up.importar",
        entidade: "produto",
        resumo: `Códigos de barras do UP importados de "${arquivo.name}": ${aplicados} produto(s) atualizado(s)`,
        dados: { mudancas: resultado.atualizar.slice(0, 300).map((a) => ({ referencia: a.referencia, variacao: a.variacao, antes: a.antes, depois: a.depois })) },
      });
    if (trocados)
      await registrar(req, {
        acao: "codigos_up.trocar",
        entidade: "produto",
        resumo: `Códigos do UP trocados pela gestora ("${arquivo.name}"): ${trocados} peça(s)`,
        dados: { trocas: confirmadas.slice(0, 300).map((c) => ({ produtoId: c.troca!.produtoId, referencia: c.troca!.referencia, atual: c.troca!.atual, novo: c.troca!.novo })) },
      });
    if (saldosGravados)
      await registrar(req, { acao: "codigos_up.saldo", entidade: "produto", resumo: `Saldo de estoque do UP atualizado de "${arquivo.name}": ${saldosGravados} código(s)` });
    return ok({ ...base, resultado, saldos: saldos.length, aplicados, trocados, saldosGravados, falhas });
  } catch (e) {
    return erro(e, 400);
  }
}
