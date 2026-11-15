import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { contextoUp, linhaUp } from "@/lib/upvendas";
import { COLUNAS_NOVOS, COLUNAS_RECOMPRAS, linhasRecompraUp, montarCsv, nomeArquivoUp, separarParaUp, tipoPlanilhaUp, valorCelulaXlsx } from "@/lib/upvendas-planilha";
import { urlDoApp } from "@/lib/url";

const MOEDA = '"R$" #,##0.00';

/**
 * GET /api/exportar?formato=xlsx|csv&tipo=novos|recompras&pedido=ID  ou  &ids=a,b,c  ou  &status=aprovado
 *  - tipo=novos (padrão): cadastro completo, só peças que ainda não existem no UP;
 *  - tipo=recompras: entrada de estoque (código de barras + quantidade) das peças que já existem no UP.
 * A quantidade é a que entrou na loja (conferência: recebida − defeito; sem conferência, a pedida).
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const p = req.nextUrl.searchParams;
    const formato = p.get("formato") === "csv" ? "csv" : "xlsx";
    const tipo = tipoPlanilhaUp(p.get("tipo"));
    const db = await getDb();
    const ids = p.get("ids")?.split(",").filter(Boolean);
    const pedido = p.get("pedido");
    const status = p.get("status");
    const todos = await db
      .select()
      .from(schema.produtos)
      .where(ids?.length ? inArray(schema.produtos.id, ids) : pedido ? eq(schema.produtos.pedidoId, pedido) : status ? eq(schema.produtos.status, status) : undefined)
      .orderBy(asc(schema.produtos.linha));
    const { novos, recompras } = separarParaUp(todos);
    const nome = nomeArquivoUp(tipo, new Date().toISOString().slice(0, 10));

    let cabecalhos: [string, string, number?][];
    let linhas: Record<string, unknown>[];
    let colunasMoeda: string[];
    let aba: string;
    if (tipo === "recompras") {
      const ctx = await contextoUp(await urlDoApp(req));
      linhas = linhasRecompraUp(recompras, ctx).linhas as unknown as Record<string, unknown>[];
      cabecalhos = COLUNAS_RECOMPRAS;
      colunasMoeda = ["custoUnitario"];
      aba = "Recompras (entrada de estoque)";
    } else {
      const ctx = await contextoUp(await urlDoApp(req), novos.map((x) => x.id));
      linhas = novos.map((x) => linhaUp(x, ctx)) as unknown as Record<string, unknown>[];
      cabecalhos = COLUNAS_NOVOS;
      colunasMoeda = ["custoCompraBruto", "custoInsumo", "custoTotal", "valorTabela", "valorTabela2"];
      aba = "Produtos novos (cadastro)";
    }

    if (formato === "csv") {
      // BOM no in\u00EDcio: o Excel abre o CSV com os acentos certos.
      return new NextResponse("\uFEFF" + montarCsv(cabecalhos, linhas), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}.csv"` },
      });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Fio de Amor Semijoias";
    const ws = wb.addWorksheet(aba, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = cabecalhos.map(([k, h, w]) => ({ header: h, key: k, width: w ?? 12 }));
    for (const l of linhas) ws.addRow(Object.fromEntries(cabecalhos.map(([k]) => [k, valorCelulaXlsx(l[k])])));
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB07A90" } };
    cab.alignment = { vertical: "middle", wrapText: true };
    cab.height = 32;
    for (const k of colunasMoeda) ws.getColumn(k).numFmt = MOEDA;
    ws.getColumn("codigoBarras").numFmt = "@";
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cabecalhos.length } };
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      },
    });
  } catch (e) {
    return erro(e);
  }
}
