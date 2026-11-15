import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel, usuarioDaRequisicao } from "@/lib/auth";
import { imagemPublica } from "@/lib/acesso";
import { registrar } from "@/lib/historico";
import { lerImagem } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

const naoEncontrada = () => new NextResponse("Imagem não encontrada", { status: 404 });

/**
 * GET /api/imagens/:id?w=300&download=1
 * Sem login, só fotos públicas (catálogo, upload, arte e foto da IA aprovada ou principal do produto):
 * o feed da Meta e o UP Vendas baixam pelo link. Páginas do pedido, referências de estilo, peças com
 * defeito e o resto exigem login (sem login → 404, como se não existisse).
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const img = await lerImagem(id);
    if (!img) return naoEncontrada();
    if (!imagemPublica(img) && !(await usuarioDaRequisicao(req))) {
      let principal = false;
      if (img.origem === "ia") {
        const db = await getDb();
        const [p] = await db.select({ id: schema.produtos.id }).from(schema.produtos).where(eq(schema.produtos.imagemId, id)).limit(1);
        principal = !!p;
      }
      if (!imagemPublica(img, principal)) return naoEncontrada();
    }
    const w = Number(req.nextUrl.searchParams.get("w") ?? 0);
    let dados: Buffer = img.dados;
    let mime = img.mime;
    if (w > 0 && w < (img.largura ?? 99999)) {
      dados = await sharp(img.dados).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      mime = "image/jpeg";
    }
    const headers: Record<string, string> = { "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable" };
    if (req.nextUrl.searchParams.get("download")) {
      headers["Content-Disposition"] = `attachment; filename="fiodeamor-${id.slice(0, 8)}.${mime === "image/png" ? "png" : "jpg"}"`;
    }
    return new NextResponse(new Uint8Array(dados), { headers });
  } catch (e) {
    return erro(e);
  }
}

/** Exclui a foto (só a gestora); a foto principal do produto fica vazia. Vai para o histórico. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    await exigirPapel(req, "gestora");
    const { id } = await params;
    const db = await getDb();
    const [img] = await db
      .select({ origem: schema.imagens.origem, produtoId: schema.imagens.produtoId, pedidoId: schema.imagens.pedidoId })
      .from(schema.imagens)
      .where(eq(schema.imagens.id, id));
    if (!img) return erro("Imagem não encontrada", 404);
    await db.update(schema.produtos).set({ imagemId: null }).where(eq(schema.produtos.imagemId, id));
    await db.delete(schema.imagens).where(eq(schema.imagens.id, id));
    await registrar(req, {
      acao: "imagem.excluir",
      entidade: img.produtoId ? "produto" : img.pedidoId ? "pedido" : "imagem",
      entidadeId: img.produtoId ?? img.pedidoId ?? id,
      resumo: `Foto excluída (${img.origem})`,
      dados: { imagemId: id, origem: img.origem, produtoId: img.produtoId, pedidoId: img.pedidoId },
    });
    return ok();
  } catch (e) {
    return erro(e);
  }
}
