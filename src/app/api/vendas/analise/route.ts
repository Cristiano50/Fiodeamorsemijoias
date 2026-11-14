import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { analiseVendas } from "@/lib/vendas";

/** GET /api/vendas/analise?inicio=AAAA-MM-DD&fim=AAAA-MM-DD → giro por SKU, curva ABC e resumos. */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    const p = req.nextUrl.searchParams;
    return ok(await analiseVendas({ inicio: p.get("inicio"), fim: p.get("fim") }));
  } catch (e) {
    return erro(e);
  }
}
