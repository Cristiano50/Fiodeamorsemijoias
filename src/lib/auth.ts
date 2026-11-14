import "server-only";
import type { NextRequest } from "next/server";
import { count } from "drizzle-orm";
import { getDb, schema } from "./db";
import { COOKIE_SESSAO, USUARIO_LOCAL, lerToken, type Papel, type SessaoUsuario } from "./sessao";

export type ModoAcesso = "aberto" | "senha" | "usuarios";

const g = globalThis as unknown as { __fda_modo?: { modo: ModoAcesso; ate: number } };

/** Modo de acesso atual (cache de 15 s). */
export async function modoAcesso(): Promise<ModoAcesso> {
  if (g.__fda_modo && g.__fda_modo.ate > Date.now()) return g.__fda_modo.modo;
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.usuarios);
  const modo: ModoAcesso = n > 0 ? "usuarios" : process.env.APP_SENHA ? "senha" : "aberto";
  g.__fda_modo = { modo, ate: Date.now() + 15000 };
  return modo;
}

export function limparCacheModo() {
  g.__fda_modo = undefined;
}

function cookieDe(req: NextRequest | Request): string | undefined {
  const r = req as NextRequest;
  if (r.cookies && typeof r.cookies.get === "function") return r.cookies.get(COOKIE_SESSAO)?.value;
  const bruto = req.headers.get("cookie") ?? "";
  for (const parte of bruto.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === COOKIE_SESSAO) return v.join("=");
  }
  return undefined;
}

/** Usuário da requisição (no acesso livre, um usuário local com papel de gestora). */
export async function usuarioDaRequisicao(req: NextRequest | Request): Promise<SessaoUsuario | null> {
  const modo = await modoAcesso();
  if (modo === "aberto") return USUARIO_LOCAL;
  return lerToken(cookieDe(req));
}

export class SemPermissao extends Error {}

/** Garante o papel mínimo; lança SemPermissao (a rota responde 403). */
export async function exigirPapel(req: NextRequest | Request, papel: Papel = "funcionario"): Promise<SessaoUsuario> {
  const u = await usuarioDaRequisicao(req);
  if (!u) throw new SemPermissao("Faça login para continuar.");
  if (papel === "gestora" && u.p !== "gestora") throw new SemPermissao("Somente a gestora pode fazer isso.");
  return u;
}
