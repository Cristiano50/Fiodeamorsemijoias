import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { salvarImagem } from "@/lib/servicos";

/**
 * Fotos de referência de estilo (expositores de veludo, fundo, luz…), por tipo de peça.
 * A IA recebe a foto da peça + a referência do mesmo tipo e reproduz o cenário com a peça real.
 */
export async function GET() {
  try {
    const db = await getDb();
    const lista = await db
      .select({ id: schema.imagens.id, meta: schema.imagens.meta, largura: schema.imagens.largura, altura: schema.imagens.altura, criadoEm: schema.imagens.criadoEm })
      .from(schema.imagens)
      .where(eq(schema.imagens.origem, "referencia"))
      .orderBy(desc(schema.imagens.criadoEm));
    return ok(lista);
  } catch (e) {
    return erro(e);
  }
}

/** multipart: arquivo, tipos (JSON: ["brinco", ...]), nome */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const arq = form.get("arquivo");
    if (!(arq instanceof File)) return erro("Envie a foto", 400);
    const tipos = JSON.parse(String(form.get("tipos") ?? "[]")) as string[];
    const id = await salvarImagem({
      dados: Buffer.from(await arq.arrayBuffer()),
      origem: "referencia",
      meta: { tipos, nome: String(form.get("nome") ?? arq.name) },
    });
    return ok({ id });
  } catch (e) {
    return erro(e);
  }
}

/** PATCH { id, tipos } — muda os tipos de peça a que a referência se aplica. */
export async function PATCH(req: NextRequest) {
  try {
    const { id, tipos } = (await req.json()) as { id: string; tipos: string[] };
    const db = await getDb();
    const [img] = await db.select({ meta: schema.imagens.meta }).from(schema.imagens).where(eq(schema.imagens.id, id));
    if (!img) return erro("Referência não encontrada", 404);
    await db.update(schema.imagens).set({ meta: { ...(img.meta ?? {}), tipos } }).where(eq(schema.imagens.id, id));
    return ok();
  } catch (e) {
    return erro(e);
  }
}
