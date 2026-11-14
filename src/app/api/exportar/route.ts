import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro } from "@/lib/api";
import { contextoUp, linhaUp, type LinhaUp } from "@/lib/upvendas";
import { urlDoApp } from "@/lib/url";

/** Colunas na ordem da tela "Cadastro de Produtos Simplificado" do UP Vendas + extras. */
const COLUNAS: [keyof LinhaUp, string, number?][] = [
  ["nome", "Nome do produto", 46],
  ["marca", "Marca", 14],
  ["referencia", "Referência", 14],
  ["codigoExterno", "Código Externo", 16],
  ["ncm", "NCM", 11],
  ["unidade", "Un. estoque", 8],
  ["categoriaVitrine", "Categoria Vitrine", 28],
  ["custoCompraBruto", "Custo Compra Bruto", 12],
  ["custoInsumo", "Custo Insumo", 12],
  ["milesimos", "Milésimos", 9],
  ["banhoOuro", "Banho Ouro", 9],
  ["banhoPrata", "Banho Prata", 9],
  ["banhoRodio", "Banho Ródio", 9],
  ["banhoVerniz", "Banho Verniz", 9],
  ["custoTotal", "Custo Total", 11],
  ["tabelaPreco", "Tabela Preço 1", 14],
  ["percentualLucro", "% Lucro Tabela 1", 10],
  ["valorTabela", "Valor Tabela 1", 11],
  ["tabelaPreco2", "Tabela Preço 2", 16],
  ["percentualLucro2", "% Lucro Tabela 2", 10],
  ["valorTabela2", "Valor Tabela 2", 11],
  ["descricaoGrade", "Descrição (grade)", 36],
  ["codigoBarras", "Cód. Barras", 16],
  ["estoque", "Saldo Estoque", 8],
  ["ativo", "Ativo", 6],
  ["acabado", "Acabado", 7],
  ["compartilhar", "Compartilhar", 8],
  ["sincronizarUpVendas", "Sincronizar com a Up vendas?", 10],
  ["tipo", "Tipo", 12],
  ["material", "Material", 14],
  ["banho", "Banho", 14],
  ["corPedra", "Cor da pedra", 16],
  ["tamanho", "Tamanho", 10],
  ["nomeComercial", "Nome comercial", 26],
  ["legenda", "Legenda Instagram", 50],
  ["imagemUrl", "Imagem", 40],
];

/** GET /api/exportar?formato=xlsx|csv&pedido=ID  ou  &ids=a,b,c */
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const formato = p.get("formato") === "csv" ? "csv" : "xlsx";
    const db = await getDb();
    const ids = p.get("ids")?.split(",").filter(Boolean);
    const pedido = p.get("pedido");
    const produtos = await db
      .select()
      .from(schema.produtos)
      .where(ids?.length ? inArray(schema.produtos.id, ids) : pedido ? eq(schema.produtos.pedidoId, pedido) : undefined)
      .orderBy(asc(schema.produtos.linha));
    const ctx = await contextoUp(urlDoApp(req), produtos.map((x) => x.id));
    const linhas = produtos.map((x) => linhaUp(x, ctx));
    const nome = `fiodeamor-produtos-${new Date().toISOString().slice(0, 10)}`;

    if (formato === "csv") {
      const esc = (v: unknown) => {
        const s = typeof v === "boolean" ? (v ? "Sim" : "Não") : typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
        return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
      };
      const csv = [COLUNAS.map((c) => c[1]).join(";"), ...linhas.map((l) => COLUNAS.map(([k]) => esc(l[k])).join(";"))].join("\r\n");
      return new NextResponse("﻿" + csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}.csv"` },
      });
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Fio de Amor Semijoias";
    const ws = wb.addWorksheet("Produtos UP Vendas", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = COLUNAS.map(([k, h, w]) => ({ header: h, key: k, width: w ?? 12 }));
    for (const l of linhas) ws.addRow({ ...l, ativo: l.ativo ? "Sim" : "Não", acabado: l.acabado ? "Sim" : "Não", compartilhar: l.compartilhar ? "Sim" : "Não", sincronizarUpVendas: l.sincronizarUpVendas ? "Sim" : "Não" });
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB07A90" } };
    cab.alignment = { vertical: "middle", wrapText: true };
    cab.height = 32;
    for (const k of ["custoCompraBruto", "custoInsumo", "custoTotal", "valorTabela", "valorTabela2"]) ws.getColumn(k).numFmt = '"R$" #,##0.00';
    ws.getColumn("codigoBarras").numFmt = "@";
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS.length } };
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
