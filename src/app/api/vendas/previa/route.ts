import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { exigirPapel } from "@/lib/auth";
import { previaVendas } from "@/lib/vendas";

export const maxDuration = 60;

/** POST /api/vendas/previa (multipart: arquivo) → cabeçalhos, mapeamento sugerido e 10 linhas de amostra. */
export async function POST(req: NextRequest) {
  try {
    await exigirPapel(req);
    const form = await req.formData();
    const arquivo = form.get("arquivo");
    if (!(arquivo instanceof File)) return erro("Envie a planilha exportada do UP Vendas (CSV ou XLSX).", 400);
    return ok(await previaVendas(arquivo));
  } catch (e) {
    return erro(e, 400); // planilha inválida ou insegura: a mensagem já vem pronta para a tela
  }
}
