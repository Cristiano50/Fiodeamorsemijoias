import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { resumoConsignado } from "@/lib/consignado";

/** GET /api/consignado → por revendedora (com ela, devolvidas, vendidas, avariadas, perdidas) e as planilhas importadas. */
export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req);
    return ok(await resumoConsignado());
  } catch (e) {
    return erro(e);
  }
}
