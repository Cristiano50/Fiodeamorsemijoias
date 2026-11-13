import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { gerarCodigos, produtosDoPedido } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/** Gera referência + EAN-13 para os itens do pedido que ainda não têm. Corpo: { ids?, refazer? } */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; refazer?: boolean };
    const ids = body.ids?.length ? body.ids : (await produtosDoPedido(id)).map((p) => p.id);
    const n = await gerarCodigos(ids, !!body.refazer);
    return ok({ gerados: n });
  } catch (e) {
    return erro(e);
  }
}
