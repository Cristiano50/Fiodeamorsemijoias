import { NextRequest } from "next/server";
import { and, asc, eq, max } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { detectarPecas } from "@/lib/ai/claude";
import { getConfig } from "@/lib/config";
import { lerLinha } from "@/lib/extracao";
import { agruparVariacoesAutomaticas, detectarRecompras, imagemParaIa, novoId, recalcularPedido, recortarImagem, salvarImagem } from "@/lib/servicos";
import { reaplicarCotacaoEfetiva } from "@/lib/fornecedores";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/** Processa UMA página/foto pendente: a IA localiza as peças, recortamos e criamos os produtos. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const db = await getDb();
    const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, id));
    if (!pedido) return erro("Pedido não encontrado", 404);
    // A IA só entra depois de a importação terminar (finalizar): senão as peças entram pela metade.
    if (pedido.status === "importando") return erro("A importação deste pedido não terminou. Continue a importação em Importar pedido antes de usar a IA.", 409);
    const [pagina] = await db
      .select()
      .from(schema.paginas)
      .where(and(eq(schema.paginas.pedidoId, id), eq(schema.paginas.processada, false)))
      .orderBy(asc(schema.paginas.ordem))
      .limit(1);
    if (!pagina) return ok({ criados: 0, restantes: 0 });

    const sistema = await getConfig("sistema");
    const b64 = await imagemParaIa(pagina.imagemId, 1568);
    const det = await detectarPecas(b64!, "image/jpeg", { pedidoId: id });
    const [{ ultima }] = await db.select({ ultima: max(schema.produtos.linha) }).from(schema.produtos).where(eq(schema.produtos.pedidoId, id));
    let linha = (ultima ?? 0) + 1;
    let criados = 0;
    for (const p of det.pecas) {
      const recorte = await recortarImagem(pagina.imagemId, p.caixa);
      if (!recorte) continue;
      const produtoId = novoId();
      const imagemId = await salvarImagem({ dados: recorte, origem: "catalogo", produtoId, pedidoId: id });
      const lida = lerLinha(p.texto_visivel.replace(/\s{2,}/g, " | "));
      await db.insert(schema.produtos).values({
        id: produtoId,
        pedidoId: id,
        linha: linha++,
        textoOriginal: p.texto_visivel,
        codigoFornecedor: lida.codigo ?? null,
        especificacao: lida.especificacao ?? null,
        precoOrigem: lida.preco ?? null,
        quantidade: lida.quantidade ?? 1,
        moeda: pedido.moeda,
        unidade: sistema.unidade,
        imagemId,
      });
      criados++;
    }
    await db.update(schema.paginas).set({ processada: true, texto: det.cabecalho }).where(eq(schema.paginas.id, pagina.id));
    if (det.cabecalho && !pedido.cabecalho) await db.update(schema.pedidos).set({ cabecalho: det.cabecalho }).where(eq(schema.pedidos.id, id));
    const pend = await db
      .select({ id: schema.paginas.id })
      .from(schema.paginas)
      .where(and(eq(schema.paginas.pedidoId, id), eq(schema.paginas.processada, false)));
    if (!pend.length) {
      // Última página: as peças novas também passam pela recompra e pelo agrupamento de variações.
      await detectarRecompras(id);
      await agruparVariacoesAutomaticas(id);
      await reaplicarCotacaoEfetiva(id); // peças novas mudam o total do pedido
      await recalcularPedido(id);
    }
    return ok({ criados, restantes: pend.length });
  } catch (e) {
    return erro(e);
  }
}
