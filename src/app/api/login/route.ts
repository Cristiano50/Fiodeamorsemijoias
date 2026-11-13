import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { COOKIE_SESSAO, assinatura } from "@/lib/sessao";

export async function POST(req: NextRequest) {
  const senhaApp = process.env.APP_SENHA;
  if (!senhaApp) return NextResponse.json({ ok: true });
  const { senha } = (await req.json().catch(() => ({}))) as { senha?: string };
  const a = Buffer.from(String(senha ?? ""));
  const b = Buffer.from(senhaApp);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ erro: "Senha incorreta" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_SESSAO, await assinatura(senhaApp), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_SESSAO);
  return res;
}
