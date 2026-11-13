import { NextRequest } from "next/server";
import { erro, ok } from "@/lib/api";
import { salvarImagem } from "@/lib/servicos";

type Ctx = { params: Promise<{ id: string }> };

/** Salva uma arte montada no estúdio (canvas do navegador) ou uma foto enviada. multipart: arquivo, origem?, meta? */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const form = await req.formData();
    const arq = form.get("arquivo");
    if (!(arq instanceof File)) return erro("Envie o arquivo da imagem", 400);
    const origem = form.get("origem") === "upload" ? "upload" : "arte";
    const meta = JSON.parse(String(form.get("meta") ?? "{}"));
    const imagemId = await salvarImagem({ dados: Buffer.from(await arq.arrayBuffer()), origem, produtoId: id, meta });
    return ok({ imagemId });
  } catch (e) {
    return erro(e);
  }
}
