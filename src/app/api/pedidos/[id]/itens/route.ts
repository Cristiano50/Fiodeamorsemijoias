import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { adicionarItens } from "@/lib/importacao";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/** Lote de itens/páginas do pedido (multipart). */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok(await adicionarItens(id, await req.formData()));
  } catch (e) {
    return erro(e);
  }
}
