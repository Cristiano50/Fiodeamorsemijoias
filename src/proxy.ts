import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, lerToken } from "@/lib/sessao";

/**
 * Controle de acesso:
 *  - "aberto" (sem usuários e sem APP_SENHA): uso local livre.
 *  - "senha" (APP_SENHA): senha única da equipe.
 *  - "usuarios": login individual; algumas áreas só para a gestora.
 * O modo vem de /api/sessao (consulta o banco) e fica em cache por 15 s.
 */

// /api/skill/contexto e /api/skill/cadastro conferem sozinhas a chave da skill (ou a sessão).
const PUBLICO = [/^\/entrar$/, /^\/api\/login$/, /^\/api\/sessao$/, /^\/api\/feed\//, /^\/api\/skill\/(contexto|cadastro)$/];

/** Áreas exclusivas da gestora (método "*" = qualquer). */
const SO_GESTORA: { caminho: RegExp; metodos: string[] }[] = [
  { caminho: /^\/configuracoes/, metodos: ["*"] },
  { caminho: /^\/historico/, metodos: ["*"] },
  { caminho: /^\/gastos/, metodos: ["*"] },
  { caminho: /^\/api\/historico/, metodos: ["*"] },
  { caminho: /^\/api\/gastos/, metodos: ["*"] },
  { caminho: /^\/api\/usuarios/, metodos: ["*"] },
  { caminho: /^\/api\/backup/, metodos: ["*"] },
  { caminho: /^\/api\/skill\/(info|baixar)/, metodos: ["*"] },
  { caminho: /^\/api\/config$/, metodos: ["PUT", "DELETE", "POST", "PATCH"] },
  { caminho: /^\/api\/referencias/, metodos: ["POST", "PATCH", "DELETE"] },
  { caminho: /^\/api\/pedidos\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/produtos\/[^/]+$/, metodos: ["DELETE"] },
  { caminho: /^\/api\/upvendas\/enviar/, metodos: ["POST"] },
  { caminho: /^\/api\/vendas\/lotes\/[^/]+$/, metodos: ["DELETE"] },
];

const g = globalThis as unknown as { __fda_modo_proxy?: { modo: string; ate: number } };

async function consultarModo(base: string): Promise<string> {
  const res = await fetch(new URL("/api/sessao?modo=1", base), { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { modo } = (await res.json()) as { modo: string };
  if (!["aberto", "senha", "usuarios"].includes(modo)) throw new Error("modo desconhecido");
  return modo;
}

async function modoDeAcesso(req: NextRequest): Promise<string> {
  if (g.__fda_modo_proxy && g.__fda_modo_proxy.ate > Date.now()) return g.__fda_modo_proxy.modo;
  // No computador da loja, pergunta ao próprio servidor (127.0.0.1); na nuvem, pelo endereço público.
  // O endereço da requisição pode ser um proxy/visualização que o servidor não alcança.
  const bases = [process.env.VERCEL ? null : `http://127.0.0.1:${process.env.PORT || 3000}`, req.nextUrl.origin].filter(Boolean) as string[];
  for (const base of bases) {
    try {
      const modo = await consultarModo(base);
      g.__fda_modo_proxy = { modo, ate: Date.now() + 15000 };
      return modo;
    } catch {
      /* tenta o próximo endereço */
    }
  }
  // Sem resposta: nunca abre o app por falha. Usa o último modo conhecido; sem nenhum, exige login.
  if (g.__fda_modo_proxy) return g.__fda_modo_proxy.modo;
  return process.env.APP_SENHA ? "senha" : "usuarios";
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICO.some((r) => r.test(pathname))) return NextResponse.next();
  // Imagens públicas: o UP Vendas e o catálogo da Meta baixam a foto pelo link.
  if (pathname.startsWith("/api/imagens/") && req.method === "GET") return NextResponse.next();

  const modo = await modoDeAcesso(req);
  if (modo === "aberto") return NextResponse.next();

  const sessao = lerToken(req.cookies.get(COOKIE_SESSAO)?.value);
  const api = pathname.startsWith("/api/");
  if (!sessao) {
    if (api) return NextResponse.json({ erro: "Faça login para continuar." }, { status: 401 });
    return redirecionar(req, `/entrar?voltar=${encodeURIComponent(pathname)}`);
  }
  const exigeGestora = SO_GESTORA.some((r) => r.caminho.test(pathname) && (r.metodos.includes("*") || r.metodos.includes(req.method)));
  if (exigeGestora && sessao.p !== "gestora") {
    if (api) return NextResponse.json({ erro: "Somente a gestora pode fazer isso." }, { status: 403 });
    return redirecionar(req, "/");
  }
  return NextResponse.next();
}

export const config = {
  // Ícones e manifest ficam fora do login: o celular busca sem o cookie da sessão para criar o atalho.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|marca/|icones/|manifest.webmanifest|pdf.worker.min.mjs).*)"],
};
