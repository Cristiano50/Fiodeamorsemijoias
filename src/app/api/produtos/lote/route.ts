import { NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { desfazerRecompra, gerarCodigos, recalcularProduto } from "@/lib/servicos";
import { exigirPapel } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { checarFator } from "@/lib/permissoes";

/** Ações em lote: { ids, acao: "aprovar" | "rascunho" | "codigos" | "recalcular" | "excluir", dados? } */
export async function POST(req: NextRequest) {
  try {
    const { ids, acao, dados } = (await req.json()) as { ids: string[]; acao: string; dados?: Record<string, unknown> };
    if (!ids?.length) return erro("Nenhum produto selecionado", 400);
    if (acao === "excluir") await exigirPapel(req, "gestora");
    if (acao === "definir" && dados && "fator" in dados) await checarFator(req, dados.fator as number | null);
    const db = await getDb();
    const agora = new Date().toISOString();
    switch (acao) {
      case "aprovar":
      case "rascunho":
        await db.update(schema.produtos).set({ status: acao === "aprovar" ? "aprovado" : "rascunho", atualizadoEm: agora }).where(inArray(schema.produtos.id, ids));
        break;
      case "codigos":
        await gerarCodigos(ids, !!dados?.refazer);
        break;
      case "recalcular":
        for (const id of ids) await recalcularProduto(id);
        break;
      case "definir": {
        const permitidos = ["tipo", "material", "banho", "tamanho", "fator", "ncm"];
        const set = Object.fromEntries(Object.entries(dados ?? {}).filter(([k]) => permitidos.includes(k)));
        await db.update(schema.produtos).set({ ...set, atualizadoEm: agora }).where(inArray(schema.produtos.id, ids));
        for (const id of ids) await recalcularProduto(id);
        break;
      }
      case "agrupar": {
        // Junta as peças selecionadas como variações de um mesmo modelo (mesma referência).
        const grupo = String(dados?.grupo ?? `G${Date.now().toString(36).toUpperCase()}`);
        const itens = await db.select().from(schema.produtos).where(inArray(schema.produtos.id, ids));
        const ref = itens.find((i) => i.referencia)?.referencia ?? null;
        await db.update(schema.produtos).set({ grupo, ...(ref ? { referencia: ref } : {}), atualizadoEm: agora }).where(inArray(schema.produtos.id, ids));
        break;
      }
      case "desagrupar":
        // A primeira peça mantém a referência; as demais ganham referência própria (o EAN não muda).
        await db.update(schema.produtos).set({ grupo: null, atualizadoEm: agora }).where(inArray(schema.produtos.id, ids));
        if (ids.length > 1) {
          await db.update(schema.produtos).set({ referencia: null }).where(inArray(schema.produtos.id, ids.slice(1)));
          await gerarCodigos(ids.slice(1), false);
        }
        break;
      case "naoRecompra":
        await desfazerRecompra(ids);
        break;
      case "excluir":
        await db.delete(schema.imagens).where(inArray(schema.imagens.produtoId, ids));
        await db.delete(schema.produtos).where(inArray(schema.produtos.id, ids));
        break;
      default:
        return erro(`Ação desconhecida: ${acao}`, 400);
    }
    if (["excluir", "definir", "codigos", "naoRecompra", "agrupar", "desagrupar"].includes(acao))
      await registrar(req, { acao: `lote.${acao}`, entidade: "produto", resumo: `${acao} em ${ids.length} peça(s)${dados ? `: ${JSON.stringify(dados)}` : ""}`, dados: { ids } });
    return ok({ ok: true, total: ids.length });
  } catch (e) {
    return erro(e);
  }
}
