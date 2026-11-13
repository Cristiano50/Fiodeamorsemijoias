import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { lerImagem } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/imagens/:id?w=300&download=1 */
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const img = await lerImagem(id);
    if (!img) return new NextResponse("Imagem não encontrada", { status: 404 });
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

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    await db.update(schema.produtos).set({ imagemId: null }).where(eq(schema.produtos.imagemId, id));
    await db.delete(schema.imagens).where(eq(schema.imagens.id, id));
    return ok();
  } catch (e) {
    return erro(e);
  }
}
