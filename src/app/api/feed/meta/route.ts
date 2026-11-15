import { NextRequest, NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { asc, eq, isNull, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel, modoAcesso } from "@/lib/auth";
import { getConfig, salvarConfig, type Sistema } from "@/lib/config";
import { fotosModeloPorProduto } from "@/lib/fotos";
import { registrar } from "@/lib/historico";
import { enderecoPrivado, montarFeedMeta, whatsappValido, type EstoqueFeed, type FormatoFeed } from "@/lib/feed-meta";
import { urlDoApp, urlPublicaConfigurada } from "@/lib/url";
import { analisarVendas, chegadaDe, estoqueDoCatalogo } from "@/lib/vendas-calculo";
import { contextoAnalise } from "@/lib/vendas";

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Chave do link público do feed; vazia = gera uma aleatória e salva. */
async function garantirChave(req: NextRequest | null, sistema: Sistema): Promise<string> {
  if (sistema.feedChave) return sistema.feedChave;
  const feedChave = randomBytes(24).toString("base64url");
  await salvarConfig("sistema", { ...sistema, feedChave });
  await registrar(req, { acao: "config.feed_chave", entidade: "config", entidadeId: "sistema", resumo: "Chave do feed do catálogo Meta criada" });
  return feedChave;
}

/** Endereço do app nos links do feed: o da internet, se houver (Meta precisa alcançar as fotos). */
const urlBase = (req: NextRequest) => urlDoApp(req);

/** Foto enviada pela loja (origem "upload") de cada produto: a principal, se for dela; senão a mais recente. */
async function fotosDaLoja(produtos: { id: string; imagemId: string | null }[]) {
  const db = await getDb();
  const i = schema.imagens;
  const linhas = await db.select({ id: i.id, produtoId: i.produtoId, criadoEm: i.criadoEm }).from(i).where(eq(i.origem, "upload"));
  const ids = new Set(produtos.map((x) => x.id));
  const principal = new Map(produtos.map((x) => [x.id, x.imagemId]));
  const out: Record<string, string> = {};
  for (const l of linhas.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))) {
    if (!l.produtoId || !ids.has(l.produtoId)) continue;
    if (out[l.produtoId] && out[l.produtoId] === principal.get(l.produtoId)) continue; // a principal vence
    out[l.produtoId] = l.id;
  }
  return out;
}

/** Estoque de cada produto: saldo do UP quando existe; senão o que entrou (pedidos que já chegaram) − vendidas. */
async function estoqueDosProdutos(): Promise<Record<string, EstoqueFeed>> {
  const ctx = await contextoAnalise(null);
  const analise = analisarVendas(ctx.produtos, ctx.vendas, ctx.params);
  return Object.fromEntries(estoqueDoCatalogo(analise.skus, ctx.saldos, ctx.idx));
}

async function gerar(req: NextRequest, sistema: Sistema, opts: { formato: FormatoFeed; todos: boolean }) {
  const db = await getDb();
  const p = schema.produtos;
  const pe = schema.pedidos;
  const linhas = await db
    .select({
      id: p.id,
      referencia: p.referencia,
      codigoBarras: p.codigoBarras,
      nome: p.nome,
      nomeComercial: p.nomeComercial,
      traducao: p.traducao,
      avaliacao: p.avaliacao,
      legenda: p.legenda,
      tipo: p.tipo,
      material: p.material,
      banho: p.banho,
      corPedra: p.corPedra,
      tamanho: p.tamanho,
      grupo: p.grupo,
      estilo: p.estilo,
      quantidade: p.quantidade,
      precoVenda: p.precoVenda,
      status: p.status,
      imagemId: p.imagemId,
      quantidadeRecebida: p.quantidadeRecebida,
      quantidadeDefeito: p.quantidadeDefeito,
      criadoEm: p.criadoEm,
      dataPedido: pe.dataCompra,
      dataChegada: pe.dataChegada,
      recebimento: pe.recebimento,
      conferidoEm: pe.conferidoEm,
    })
    .from(p)
    .leftJoin(pe, eq(p.pedidoId, pe.id))
    .where(or(isNull(pe.status), ne(pe.status, "importando"))) // importação incompleta fica fora
    .orderBy(asc(p.criadoEm), asc(p.linha)); // recompra (mesmo EAN) vem depois e atualiza a linha
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const produtos = linhas.map((x) => ({ ...x, chegou: chegadaDe(x, hoje).chegou }));
  // Só busca as fotos das peças que podem entrar no feed.
  const candidatos = opts.todos ? produtos : produtos.filter((x) => x.status === "aprovado" && (x.precoVenda ?? 0) > 0);
  const [fotos, fotosLoja, estoque, marca, taxonomia] = await Promise.all([
    fotosModeloPorProduto(candidatos.map((x) => x.id)),
    fotosDaLoja(candidatos),
    estoqueDosProdutos(),
    getConfig("marca"),
    getConfig("taxonomia"),
  ]);
  return montarFeedMeta(
    produtos,
    { urlBase: await urlBase(req), marca: marca.nome, whatsapp: sistema.whatsappNumero, linkModelo: sistema.linkProdutoModelo, taxonomia, fotos, fotosLoja, estoque },
    opts,
  );
}

/**
 * GET /api/feed/meta?chave=...&formato=csv|tsv&todos=0|1
 *   Arquivo do catálogo para o Commerce Manager da Meta (WhatsApp Business e Instagram Shopping).
 *   Rota pública (a Meta busca o arquivo sozinha), mas SEMPRE com a chave do feed, inclusive no acesso
 *   livre (sem ela, qualquer aparelho da rede leria o catálogo). Sem chave ou chave errada: 404.
 *   A chave nasce quando a gestora abre Configurações (info=1), nunca por um pedido anônimo.
 * GET /api/feed/meta?info=1 (gestora)
 *   Dados para a tela de Configurações: URL do feed com a chave, quantas peças entram e avisos.
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const sistema = await getConfig("sistema");

    if (q.get("info")) {
      await exigirPapel(req, "gestora");
      const modo = await modoAcesso();
      const chave = await garantirChave(req, sistema);
      const base = await urlBase(req);
      const url = `${base}/api/feed/meta?chave=${encodeURIComponent(chave)}`;
      const { itens, total, semFotoAprovada } = await gerar(req, sistema, { formato: "csv", todos: false });
      return ok({
        chave,
        url,
        urlTsv: `${url}&formato=tsv`,
        urlBase: base,
        enderecoPrivado: enderecoPrivado(base),
        urlPublicaDefinida: !!(await urlPublicaConfigurada()),
        whatsappValido: whatsappValido(sistema.whatsappNumero),
        modo,
        itens,
        total,
        semFotoAprovada,
      });
    }

    // Chave obrigatória em todos os modos; sem chave criada ainda, também não há feed para ninguém.
    const chave = q.get("chave") ?? "";
    if (!sistema.feedChave || !chave || !iguais(chave, sistema.feedChave)) return erro("Não encontrado.", 404);

    const formato: FormatoFeed = q.get("formato") === "tsv" ? "tsv" : "csv";
    const { texto } = await gerar(req, sistema, { formato, todos: q.get("todos") === "1" });
    const nome = `fiodeamor-catalogo-meta-${new Date().toISOString().slice(0, 10)}.${formato}`;
    return new NextResponse(texto, {
      headers: {
        "Content-Type": `${formato === "tsv" ? "text/tab-separated-values" : "text/csv"}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return erro(e);
  }
}
