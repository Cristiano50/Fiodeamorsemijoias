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

async function modoDeAcesso(req: NextRequest): Promise<string> {
  if (g.__fda_modo_proxy && g.__fda_modo_proxy.ate > Date.now()) return g.__fda_modo_proxy.modo;
  try {
    const res = await fetch(new URL("/api/sessao?modo=1", req.nextUrl.origin), { cache: "no-store" });
    const { modo } = (await res.json()) as { modo: string };
    g.__fda_modo_proxy = { modo, ate: Date.now() + 15000 };
    return modo;
  } catch {
    // Sem resposta: por segurança, exige login se houver senha configurada.
    return process.env.APP_SENHA ? "senha" : "aberto";
  }
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
    const url = req.nextUrl.clone();
    url.pathname = "/entrar";
    url.searchParams.set("voltar", pathname);
    return NextResponse.redirect(url);
  }
  const exigeGestora = SO_GESTORA.some((r) => r.caminho.test(pathname) && (r.metodos.includes("*") || r.metodos.includes(req.method)));
  if (exigeGestora && sessao.p !== "gestora") {
    if (api) return NextResponse.json({ erro: "Somente a gestora pode fazer isso." }, { status: 403 });
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|marca/|pdf.worker.min.mjs).*)"],
};
