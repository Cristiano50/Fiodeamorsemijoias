import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { listarLotes } from "@/lib/vendas";

/** GET /api/vendas/lotes → planilhas importadas, da mais recente para a mais antiga. */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    return ok(await listarLotes());
  } catch (e) {
    return erro(e);
  }
}
