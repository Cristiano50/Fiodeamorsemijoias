import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { modoAcesso } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { COOKIE_SESSAO, conferirSenha, criarToken, type Papel } from "@/lib/sessao";

const iguais = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function comCookie(req: NextRequest, token: string, usuario: { nome: string; papel: Papel }) {
  const res = NextResponse.json({ ok: true, usuario });
  res.cookies.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

/** POST { login?, senha } — entra com usuário e senha (ou a senha única da equipe). */
export async function POST(req: NextRequest) {
  const { login, senha } = (await req.json().catch(() => ({}))) as { login?: string; senha?: string };
  const modo = await modoAcesso();
  if (modo === "aberto") return NextResponse.json({ ok: true });
  const falha = async () => {
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ erro: "Usuário ou senha incorretos" }, { status: 401 });
  };

  if (modo === "senha") {
    if (!iguais(String(senha ?? ""), process.env.APP_SENHA ?? "")) return falha();
    return comCookie(req, criarToken({ u: "equipe", n: "Equipe", p: "gestora" }), { nome: "Equipe", papel: "gestora" });
  }

  const db = await getDb();
  const [u] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.login, String(login ?? "").trim().toLowerCase()));
  if (!u || !u.ativo || !conferirSenha(String(senha ?? ""), u.senhaHash)) return falha();
  const papel = u.papel as Papel;
  const res = comCookie(req, criarToken({ u: u.id, n: u.nome, p: papel }), { nome: u.nome, papel });
  await registrar(null, { acao: "login", entidade: "usuario", entidadeId: u.id, resumo: `${u.nome} entrou no app` });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_SESSAO);
  return res;
}
