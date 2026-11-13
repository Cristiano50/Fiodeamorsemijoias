import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { recalcularPedido, resumoPedido } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await recalcularPedido(id);
    return ok(await resumoPedido(id));
  } catch (e) {
    return erro(e);
  }
}
