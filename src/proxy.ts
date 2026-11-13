import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_SESSAO, assinatura } from "@/lib/sessao";

/** Protege o app com APP_SENHA (se definida). */
export async function proxy(req: NextRequest) {
  const senha = process.env.APP_SENHA;
  if (!senha) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/entrar" || pathname === "/api/login") return NextResponse.next();
  // Imagens públicas: o UP Vendas precisa baixar a foto do produto pelo link.
  if (pathname.startsWith("/api/imagens/") && req.method === "GET") return NextResponse.next();
  const cookie = req.cookies.get(COOKIE_SESSAO)?.value;
  if (cookie && cookie === (await assinatura(senha))) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/entrar";
  url.searchParams.set("voltar", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|marca/).*)"],
};
