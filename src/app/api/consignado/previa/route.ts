import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { previaConsignado } from "@/lib/consignado";

export const maxDuration = 60;

/** POST /api/consignado/previa (multipart: arquivo) → cabeçalhos, mapeamento sugerido e 10 linhas de amostra. */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro("Envie a planilha de consignado (maletas) exportada do UP Vendas (CSV ou XLSX).", 400);
    return ok(await previaConsignado(arquivo));
  } catch (e) {
    return erro(e, 400); // planilha inválida ou insegura: a mensagem já vem pronta para a tela
  }
}
