import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { analisarItens } from "@/lib/ai/claude";
import { agruparVariacoesAutomaticas, aplicarAnalise, detectarRecompras, imagemParaIa, produtosSemAnalise, recalcularPedido } from "@/lib/servicos";
import { reaplicarCotacaoEfetiva } from "@/lib/fornecedores";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/**
 * Analisa um lote de itens com a IA (foto + linha do pedido).
 * Corpo: { ids?: string[] (reanalisar específicos), lote?: number }
 * O navegador chama em sequência até "restantes" chegar a zero, mostrando o progresso.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; lote?: number };
    const db = await getDb();
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    // A IA só entra depois de a importação terminar (finalizar).
    if (pedido.status === "importando") return erro("A importação deste pedido não terminou. Continue a importação em Importar pedido antes de usar a IA.", 409);

    const lote = Math.min(Math.max(body.lote ?? 6, 1), 12);
    const alvo = body.ids?.length
      ? await db.select().from(schema.produtos).where(inArray(schema.produtos.id, body.ids.slice(0, lote)))
      : (await produtosSemAnalise(id)).slice(0, lote);

    if (alvo.length) {
      const entrada = await Promise.all(
        alvo.map(async (p) => ({
          id: p.id,
          texto: p.textoOriginal ?? "",
          imagemBase64: p.imagemId ? await imagemParaIa(p.imagemId) : undefined,
        })),
      );
      const resultado = await analisarItens(entrada, {
        cabecalho: pedido.cabecalho,
        colunas: pedido.colunas,
        moeda: pedido.moeda,
        fornecedor: pedido.fornecedor,
        pedidoId: id,
      });
      for (const r of resultado) {
        const p = alvo.find((a) => a.id === r.id);
        // Números lidos pela heurística (preço × qtd = total) têm prioridade sobre a leitura da IA.
        if (p) await aplicarAnalise(p.id, r, p.precoOrigem == null);
      }
      // A IA pode ter preenchido preço/quantidade: com a cotação efetiva em uso, ela é refeita.
      await reaplicarCotacaoEfetiva(id);
      await recalcularPedido(id);
    }
    const restantes = body.ids?.length ? 0 : (await produtosSemAnalise(id)).length;
    if (restantes === 0) {
      // A IA terminou: o código lido por ela pode revelar recompras (e variações) que o documento não mostrava.
      if (alvo.length) {
        await detectarRecompras(id);
        await agruparVariacoesAutomaticas(id);
        await recalcularPedido(id);
      }
      if (pedido.status !== "concluido") await db.update(schema.pedidos).set({ status: "analisado" }).where(eq(schema.pedidos.id, id));
    }
    return ok({ analisados: alvo.length, restantes });
  } catch (e) {
    return erro(e);
  }
}
