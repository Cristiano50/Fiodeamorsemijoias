import { NextRequest, NextResponse } from "next/server";
import { erro } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { analiseVendas, csvRecompra, hojeLocal, itensRecompra, xlsxRecompra } from "@/lib/vendas";

export const maxDuration = 120;

/**
 * GET /api/vendas/recompra?formato=xlsx|csv&inicio=&fim=
 * Lista de recompra para o fornecedor: foto, código do fornecedor, referência, vendido, estoque e
 * quantidade sugerida, agrupada por fornecedor (no XLSX, uma aba por fornecedor). Sem preços.
 */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const p = req.nextUrl.searchParams;
    const formato = p.get("formato") === "csv" ? "csv" : "xlsx";
    const analise = await analiseVendas({ inicio: p.get("inicio"), fim: p.get("fim") });
    const itens = itensRecompra(analise);
    const nome = `fiodeamor-recompra-${hojeLocal()}`;
    const origem = req.nextUrl.origin;
    if (formato === "csv") {
      return new NextResponse(csvRecompra(itens, origem), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}.csv"` },
      });
    }
    return new NextResponse(await xlsxRecompra(itens, origem, analise.apelidosFornecedor), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}.xlsx"`,
      },
    });
  } catch (e) {
    return erro(e);
  }
}
