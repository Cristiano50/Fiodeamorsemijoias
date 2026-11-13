import "server-only";
import { eq, max } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig } from "./config";
import { lerLinha } from "./extracao";
import { novoId, salvarImagem } from "./servicos";

/**
 * Grava um lote de itens (linha do documento + foto recortada) e de páginas/fotos sem tabela.
 * O navegador envia em lotes pequenos: funciona com pedidos grandes e com o limite de 4,5 MB da Vercel.
 * multipart: itens = [{ linha, texto, campo }], arquivos "item_N" e "pagina_*".
 */
export async function adicionarItens(pedidoId: string, form: FormData) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) throw new Error("Pedido não encontrado");
  const sistema = await getConfig("sistema");
  const itens = JSON.parse(String(form.get("itens") ?? "[]")) as { linha: number; texto: string; campo?: string }[];

  for (const it of itens) {
    const produtoId = novoId();
    const f = it.campo ? form.get(it.campo) : null;
    const imagemId =
      f instanceof File ? await salvarImagem({ dados: Buffer.from(await f.arrayBuffer()), origem: "catalogo", produtoId, pedidoId }) : null;
    const lida = lerLinha(it.texto);
    await db.insert(schema.produtos).values({
      id: produtoId,
      pedidoId,
      linha: it.linha,
      textoOriginal: it.texto,
      codigoFornecedor: lida.codigo ?? null,
      descricaoOriginal: lida.descricao ?? null,
      variacao: lida.especificacao ?? null,
      precoOrigem: lida.preco ?? null,
      quantidade: lida.quantidade ?? 1,
      moeda: pedido.moeda,
      unidade: sistema.unidade,
      imagemId,
    });
  }

  const [{ ultima }] = await db.select({ ultima: max(schema.paginas.ordem) }).from(schema.paginas).where(eq(schema.paginas.pedidoId, pedidoId));
  let ordem = (ultima ?? -1) + 1;
  let paginas = 0;
  for (const [campo, valor] of form.entries()) {
    if (!campo.startsWith("pagina_") || !(valor instanceof File)) continue;
    const imagemId = await salvarImagem({ dados: Buffer.from(await valor.arrayBuffer()), origem: "pagina", pedidoId });
    await db.insert(schema.paginas).values({ id: novoId(), pedidoId, ordem: ordem++, imagemId, texto: null });
    paginas++;
  }
  return { itens: itens.length, paginas };
}
