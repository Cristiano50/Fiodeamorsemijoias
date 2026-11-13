import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { gerarFotoIA, montarPromptFoto, type Proporcao } from "@/lib/ai/imagem";
import { getConfig } from "@/lib/config";
import { lerImagem, salvarImagem } from "@/lib/servicos";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/** Gera foto publicitária com IA a partir da foto do catálogo. Corpo: { imagemId?, cenarioId?, proporcao?, extra?, provedor? } */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      imagemId?: string;
      cenarioId?: string;
      proporcao?: Proporcao;
      extra?: string;
      provedor?: "gemini" | "openai";
    };
    const db = await getDb();
    const [p] = await db.select().from(schema.produtos).where(eq(schema.produtos.id, id));
    if (!p) return erro("Produto não encontrado", 404);
    const base = await lerImagem(body.imagemId ?? p.imagemId ?? "");
    if (!base) return erro("O produto não tem foto de referência.", 400);
    const marca = await getConfig("marca");
    const prompt = montarPromptFoto(marca, {
      tipo: p.tipo,
      subtipo: p.subtipo,
      banho: p.banho,
      tamanho: p.tamanho,
      cenarioId: body.cenarioId,
      extra: body.extra,
      descricaoPeca: [p.traducao, p.avaliacao].filter(Boolean).join(" — "),
    });
    const r = await gerarFotoIA({ imagem: base.dados, mime: base.mime, prompt, proporcao: body.proporcao ?? "4:5", provedor: body.provedor });
    const imagemId = await salvarImagem({
      dados: r.dados,
      origem: "ia",
      produtoId: id,
      meta: { provedor: r.provedor, modelo: r.modelo, cenario: body.cenarioId, prompt, geradaPorIa: true },
    });
    return ok({ imagemId, provedor: r.provedor, modelo: r.modelo });
  } catch (e) {
    return erro(e);
  }
}
