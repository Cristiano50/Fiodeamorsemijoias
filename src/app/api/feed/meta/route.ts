import { NextRequest, NextResponse } from "next/server";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel, modoAcesso } from "@/lib/auth";
import { getConfig, salvarConfig, type Sistema } from "@/lib/config";
import { fotosModeloPorProduto } from "@/lib/fotos";
import { registrar } from "@/lib/historico";
import { enderecoPrivado, montarFeedMeta, urlBaseDe, whatsappValido, type FormatoFeed } from "@/lib/feed-meta";

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

function urlBase(req: NextRequest) {
  return urlBaseDe({
    publica: process.env.NEXT_PUBLIC_URL_PUBLICA,
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    proto: req.headers.get("x-forwarded-proto"),
    origem: req.nextUrl.origin,
  });
}

async function gerar(req: NextRequest, sistema: Sistema, opts: { formato: FormatoFeed; todos: boolean }) {
  const db = await getDb();
  const p = schema.produtos;
  const produtos = await db
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
    })
    .from(p)
    .orderBy(asc(p.criadoEm), asc(p.linha)); // recompra (mesmo EAN) vem depois e atualiza a linha
  // Só busca as fotos com IA das peças que podem entrar no feed.
  const candidatos = opts.todos ? produtos : produtos.filter((x) => x.status === "aprovado" && (x.precoVenda ?? 0) > 0);
  const [fotos, marca, taxonomia] = await Promise.all([
    fotosModeloPorProduto(candidatos.map((x) => x.id)),
    getConfig("marca"),
    getConfig("taxonomia"),
  ]);
  return montarFeedMeta(
    produtos,
    { urlBase: urlBase(req), marca: marca.nome, whatsapp: sistema.whatsappNumero, linkModelo: sistema.linkProdutoModelo, taxonomia, fotos },
    opts,
  );
}

/**
 * GET /api/feed/meta?chave=...&formato=csv|tsv&todos=0|1
 *   Arquivo do catálogo para o Commerce Manager da Meta (WhatsApp Business e Instagram Shopping).
 *   Rota pública (a Meta busca o arquivo sozinha); fora do acesso livre, exige a chave do feed.
 * GET /api/feed/meta?info=1 (gestora)
 *   Dados para a tela de Configurações: URL do feed com a chave, quantas peças entram e avisos.
 */
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const [sistema, modo] = await Promise.all([getConfig("sistema"), modoAcesso()]);

    if (q.get("info")) {
      await exigirPapel(req, "gestora");
      const chave = await garantirChave(req, sistema);
      const base = urlBase(req);
      const url = `${base}/api/feed/meta?chave=${encodeURIComponent(chave)}`;
      const { itens, total } = await gerar(req, sistema, { formato: "csv", todos: false });
      return ok({
        chave,
        url,
        urlTsv: `${url}&formato=tsv`,
        urlBase: base,
        enderecoPrivado: enderecoPrivado(base),
        urlPublicaDefinida: !!process.env.NEXT_PUBLIC_URL_PUBLICA,
        whatsappValido: whatsappValido(sistema.whatsappNumero),
        modo,
        itens,
        total,
      });
    }

    if (modo !== "aberto") {
      const chave = q.get("chave") ?? "";
      if (!sistema.feedChave) {
        await garantirChave(null, sistema);
        return erro("A chave do feed acabou de ser criada. Copie a URL em Configurações, na aba “WhatsApp, catálogo Meta e backup”.", 403);
      }
      if (!chave || !iguais(chave, sistema.feedChave)) return erro("Chave do feed inválida. Copie a URL de novo em Configurações, na aba “WhatsApp, catálogo Meta e backup”.", 403);
    }

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
