/**
 * Sessão do app (cookie assinado). Usado pelo proxy e pelas rotas.
 *  - Sem usuários cadastrados e sem APP_SENHA: acesso livre (uso local), como gestora.
 *  - Com APP_SENHA (sem usuários): senha única da equipe.
 *  - Com usuários cadastrados: login e senha individuais, papéis gestora/funcionario.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const COOKIE_SESSAO = "fda_sessao";
export type Papel = "gestora" | "funcionario";
export interface SessaoUsuario {
  u: string; // id do usuário ("equipe" na senha única, "local" no acesso livre)
  n: string; // nome
  p: Papel;
  e: number; // expira (ms)
}

let segredoCache: string | null = null;
/** Segredo de assinatura: APP_SEGREDO, senão APP_SENHA, senão um arquivo gerado em dados/. */
export function segredoSessao(): string {
  if (segredoCache) return segredoCache;
  const env = process.env.APP_SEGREDO || process.env.APP_SENHA;
  if (env) return (segredoCache = env);
  const arq = path.resolve(process.cwd(), "dados", ".segredo-sessao");
  try {
    segredoCache = fs.readFileSync(arq, "utf8").trim();
  } catch {
    segredoCache = randomBytes(32).toString("hex");
    try {
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, segredoCache, { mode: 0o600 });
    } catch {
      /* ambiente sem disco gravável (nuvem): defina APP_SEGREDO */
    }
  }
  return segredoCache!;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const assinar = (dados: string) => createHmac("sha256", segredoSessao()).update(dados).digest("base64url");

export function criarToken(u: Omit<SessaoUsuario, "e">, dias = 30): string {
  const dados = b64(JSON.stringify({ ...u, e: Date.now() + dias * 86400000 }));
  return `${dados}.${assinar(dados)}`;
}

export function lerToken(token: string | undefined | null): SessaoUsuario | null {
  if (!token || !token.includes(".")) return null;
  const [dados, sig] = token.split(".");
  const esperado = assinar(dados);
  if (!sig || sig.length !== esperado.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const s = JSON.parse(Buffer.from(dados, "base64url").toString()) as SessaoUsuario;
    return s.e > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function hashSenha(senha: string): string {
  const sal = randomBytes(16).toString("hex");
  return `scrypt$${sal}$${scryptSync(senha, sal, 64).toString("hex")}`;
}

export function conferirSenha(senha: string, hash: string): boolean {
  const [alg, sal, h] = hash.split("$");
  if (alg !== "scrypt" || !sal || !h) return false;
  const calc = scryptSync(senha, sal, 64);
  const ref = Buffer.from(h, "hex");
  return calc.length === ref.length && timingSafeEqual(calc, ref);
}

export const USUARIO_LOCAL: SessaoUsuario = { u: "local", n: "Acesso local", p: "gestora", e: Number.MAX_SAFE_INTEGER };
