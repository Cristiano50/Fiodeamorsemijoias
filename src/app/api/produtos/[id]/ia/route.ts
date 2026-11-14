import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { gerarFotoModelo } from "@/lib/fotos";
import type { Proporcao } from "@/lib/ai/imagem";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/**
 * Gera a foto da peça na modelo (IA) e submete à aprovação do especialista de marketing.
 * Corpo: { imagemId?, cenarioId?, proporcao?, extra?, provedor?, tentativas? }
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      imagemId?: string;
      cenarioId?: string;
      proporcao?: Proporcao;
      extra?: string;
      provedor?: "gemini" | "openai";
      tentativas?: number;
    };
    return ok(await gerarFotoModelo(id, body));
  } catch (e) {
    return erro(e);
  }
}
