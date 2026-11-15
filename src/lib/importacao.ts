import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig } from "./config";
import { lerLinha } from "./extracao";
import { novoId, salvarImagem } from "./servicos";

/**
 * Grava um lote de itens (linha do documento + foto recortada) e de páginas/fotos sem tabela.
 * O navegador envia em lotes pequenos: funciona com pedidos grandes e com o limite de 4,5 MB da Vercel.
 * multipart: itens = [{ linha, texto, campo }], arquivos "item_N" e "pagina_<ordem>".
 *
 * Idempotente (o navegador pode fechar no meio e a importação continuar depois):
 *  - `linha` é a linha do documento (estável: o índice da linha extraída, não a posição na lista filtrada);
 *    a mesma linha não entra duas vezes no mesmo pedido (pula e conta em "ignoradas");
 *  - página/foto com a mesma ordem também não entra duas vezes.
 */
export async function adicionarItens(pedidoId: string, form: FormData) {
  const db = await getDb();
  const [pedido] = await db.select().from(schema.pedidos).where(eq(schema.pedidos.id, pedidoId));
  if (!pedido) throw new Error("Pedido não encontrado");
  const sistema = await getConfig("sistema");
  const itens = JSON.parse(String(form.get("itens") ?? "[]")) as { linha: number; texto: string; campo?: string }[];
  const { linhas, paginas: ordens } = await jaRecebidos(pedidoId);
  const linhasJa = new Set(linhas);
  let gravados = 0;
  let ignoradas = 0;

  for (const it of itens) {
    const linha = Number(it.linha);
    if (!Number.isInteger(linha) || linha < 1 || linhasJa.has(linha) || typeof it.texto !== "string") {
      ignoradas++;
      continue;
    }
    const produtoId = novoId();
    const f = it.campo ? form.get(it.campo) : null;
    const imagemId =
      f instanceof File ? await salvarImagem({ dados: Buffer.from(await f.arrayBuffer()), origem: "catalogo", produtoId, pedidoId }) : null;
    const lida = lerLinha(it.texto);
    await db.insert(schema.produtos).values({
      id: produtoId,
      pedidoId,
      linha,
      textoOriginal: it.texto,
      codigoFornecedor: lida.codigo ?? null,
      descricaoOriginal: lida.descricao ?? null,
      // A especificação do fornecedor (G, MR, 金色, 16…) é a chave da recompra; a variação fica para a IA/a loja.
      especificacao: lida.especificacao ?? null,
      precoOrigem: lida.preco ?? null,
      quantidade: lida.quantidade ?? 1,
      moeda: pedido.moeda,
      unidade: sistema.unidade,
      imagemId,
    });
    linhasJa.add(linha);
    gravados++;
  }

  const ordensJa = new Set(ordens);
  let proxima = ordens.length ? Math.max(...ordens) + 1 : 0;
  let paginas = 0;
  for (const [campo, valor] of form.entries()) {
    if (!campo.startsWith("pagina_") || !(valor instanceof File)) continue;
    const m = /^pagina_(\d+)$/.exec(campo);
    const ordem = m ? Number(m[1]) : proxima;
    if (ordensJa.has(ordem)) {
      ignoradas++;
      continue;
    }
    const imagemId = await salvarImagem({ dados: Buffer.from(await valor.arrayBuffer()), origem: "pagina", pedidoId });
    await db.insert(schema.paginas).values({ id: novoId(), pedidoId, ordem, imagemId, texto: null });
    ordensJa.add(ordem);
    proxima = Math.max(proxima, ordem + 1);
    paginas++;
  }
  return { itens: gravados, paginas, ignoradas };
}

/** O que o pedido já recebeu: linhas do documento e ordens das páginas/fotos (para continuar uma importação). */
export async function jaRecebidos(pedidoId: string) {
  const db = await getDb();
  const [linhas, paginas] = await Promise.all([
    db.select({ linha: schema.produtos.linha }).from(schema.produtos).where(eq(schema.produtos.pedidoId, pedidoId)),
    db.select({ ordem: schema.paginas.ordem }).from(schema.paginas).where(eq(schema.paginas.pedidoId, pedidoId)),
  ]);
  return {
    linhas: linhas.map((l) => l.linha).filter((l): l is number => l != null),
    paginas: paginas.map((p) => p.ordem),
  };
}
