import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, lerSemConferir, type Papel } from "@/lib/sessao";
import { ehLocal } from "@/lib/rede";
import { decisaoAberto, decisaoInicial, decisaoSemConferencia, decisaoSessao, paginaAviso, type Decisao } from "@/lib/acesso";

/**
 * Controle de acesso. As regras (listas PUBLICO/SO_GESTORA, tamanho do envio, origem, modos) estão em
 * src/lib/acesso.ts, em funções puras com testes; aqui só se busca o modo e a sessão e se responde.
 *  - antes de tudo: envio grande demais (413) e pedido vindo de outro site (403);
 *  - "aberto" (sem usuários e sem APP_SENHA): só o próprio computador do servidor;
 *  - "senha" (APP_SENHA): senha única da equipe;
 *  - "usuarios": login individual; algumas áreas só para a gestora.
 *
 * O proxy roda em Node, no mesmo processo do app, mas num pacote à parte: não abre o banco (nem a
 * chave das sessões, que fica lá e nunca sai do servidor). O modo e a conferência do login vêm do
 * próprio servidor por /api/sessao, em 127.0.0.1 (na Vercel, pelo endereço público), com cache curto:
 * modo 15 s, sessão 10 s (o servidor confere assinatura, validade e a versão da sessão no banco).
 * Sem resposta, nunca abre o app: modo → o último conhecido ou login; sessão → 503, sem apagar o login.
 */

type UsuarioProxy = { id: string; nome: string; papel: Papel };
type Global = {
  __fda_modo_proxy?: { modo: string; ate: number };
  __fda_sessoes_proxy?: Map<string, { usuario: UsuarioProxy | null; ate: number }>;
};
const g = globalThis as unknown as Global;
const MODOS = ["aberto", "senha", "usuarios"];
// Em desenvolvimento, a primeira consulta compila a rota /api/sessao e demora mais.
const TEMPO_LIMITE = process.env.NODE_ENV === "development" ? 15000 : 5000;
// Soma com o cache de 30 s da versão no servidor: na nuvem, um login derrubado cai em até ~40 s.
// No computador da loja cai na hora (o servidor limpa este cache, que fica no mesmo processo).
const CACHE_SESSAO_MS = 10000;
const pendentes = new Map<string, Promise<UsuarioProxy | null>>();

/** No computador da loja, o próprio servidor (127.0.0.1); na nuvem, o endereço público. */
function enderecosDoServidor(req: NextRequest): string[] {
  // O endereço da requisição pode ser um proxy/visualização que o servidor não alcança.
  return [process.env.VERCEL ? null : `http://127.0.0.1:${process.env.PORT || 3000}`, req.nextUrl.origin].filter(Boolean) as string[];
}

async function perguntar(req: NextRequest, caminho: string, token?: string): Promise<{ modo: string; usuario?: unknown }> {
  let ultimoErro: unknown = new Error("sem resposta");
  for (const base of enderecosDoServidor(req)) {
    try {
      const res = await fetch(new URL(caminho, base), {
        cache: "no-store",
        headers: token ? { cookie: `${COOKIE_SESSAO}=${token}` } : undefined,
        signal: AbortSignal.timeout(TEMPO_LIMITE),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as { modo?: string; usuario?: unknown };
      if (!r || !MODOS.includes(String(r.modo))) throw new Error("modo desconhecido");
      g.__fda_modo_proxy = { modo: String(r.modo), ate: Date.now() + 15000 };
      return { modo: String(r.modo), usuario: r.usuario };
    } catch (e) {
      ultimoErro = e; // tenta o próximo endereço
    }
  }
  throw ultimoErro;
}

async function modoDeAcesso(req: NextRequest): Promise<string> {
  if (g.__fda_modo_proxy && g.__fda_modo_proxy.ate > Date.now()) return g.__fda_modo_proxy.modo;
  try {
    return (await perguntar(req, "/api/sessao?modo=1")).modo;
  } catch {
    // Sem resposta: nunca abre o app por falha. Usa o último modo conhecido; sem nenhum, exige login.
    if (g.__fda_modo_proxy) return g.__fda_modo_proxy.modo;
    return process.env.APP_SENHA ? "senha" : "usuarios";
  }
}

function usuarioDe(v: unknown): UsuarioProxy | null {
  const u = v as { id?: unknown; nome?: unknown; papel?: unknown } | null;
  if (!u || typeof u.id !== "string" || (u.papel !== "gestora" && u.papel !== "funcionario")) return null;
  return { id: u.id, nome: String(u.nome ?? ""), papel: u.papel };
}

/** O servidor confere o cookie (assinatura, validade, versão); a resposta fica 30 s em cache. Falha → lança. */
async function conferirSessao(req: NextRequest, token: string): Promise<UsuarioProxy | null> {
  const cache = (g.__fda_sessoes_proxy ??= new Map());
  const c = cache.get(token);
  if (c && c.ate > Date.now()) return c.usuario;
  let p = pendentes.get(token);
  if (!p) {
    p = perguntar(req, "/api/sessao", token)
      .then((r) => {
        // Virou acesso livre: a resposta seria a do próprio servidor (127.0.0.1), não a do aparelho.
        if (r.modo === "aberto") return null;
        const usuario = usuarioDe(r.usuario);
        if (cache.size >= 500) {
          const agora = Date.now();
          for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
          if (cache.size >= 500) cache.clear();
        }
        cache.set(token, { usuario, ate: Date.now() + CACHE_SESSAO_MS });
        return usuario;
      })
      .finally(() => pendentes.delete(token));
    pendentes.set(token, p);
  }
  return p;
}

/**
 * Redireciona para um caminho do app no MESMO endereço que o aparelho usou (ex.: http://192.168.0.10:3000).
 * O endereço interno do servidor (127.0.0.1) não serve para o celular: lá ele aponta para o próprio celular.
 */
function redirecionar(req: NextRequest, caminho: string) {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
  const base = host && /^[a-z0-9.\-[\]:]+$/i.test(host) ? `${proto === "https" ? "https" : "http"}://${host}` : req.nextUrl.origin;
  return NextResponse.redirect(new URL(caminho, base));
}

function responder(req: NextRequest, d: Decisao) {
  switch (d.tipo) {
    case "seguir":
      return NextResponse.next();
    case "json":
      return NextResponse.json({ erro: d.erro }, { status: d.status, headers: d.status === 503 ? { "Retry-After": "5" } : undefined });
    case "pagina":
      return new NextResponse(paginaAviso(d.titulo, d.mensagem), {
        status: d.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    case "redirecionar":
      return redirecionar(req, d.para);
  }
}

export async function proxy(req: NextRequest) {
  const caminho = req.nextUrl.pathname;
  const metodo = req.method;
  const inicial = decisaoInicial(caminho, metodo, req.headers);
  if (inicial) return responder(req, inicial);

  const modo = await modoDeAcesso(req);
  if (modo === "aberto") return responder(req, decisaoAberto(caminho, ehLocal(req.headers)));

  const token = req.cookies.get(COOKIE_SESSAO)?.value;
  const dados = lerSemConferir(token);
  let usuario: UsuarioProxy | null = null;
  // Cookie vencido ou de formato antigo nem vai ao servidor.
  if (token && dados && dados.e > Date.now()) {
    try {
      usuario = await conferirSessao(req, token);
    } catch {
      return responder(req, decisaoSemConferencia(caminho));
    }
  }
  return responder(req, decisaoSessao(caminho, metodo, usuario));
}

export const config = {
  // Ícones e manifest ficam fora do login: o celular busca sem o cookie da sessão para criar o atalho.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|marca/|icones/|manifest.webmanifest|pdf.worker.min.mjs).*)"],
};
