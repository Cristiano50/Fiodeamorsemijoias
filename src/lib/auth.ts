import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getConfig } from "./config";
import { ehLocal } from "./rede";
import { MENSAGEM_ABERTO_REMOTO, MENSAGEM_GESTORA, MENSAGEM_LOGIN } from "./acesso";
import {
  COOKIE_SESSAO,
  USUARIO_LOCAL,
  conferirToken,
  criarToken,
  impressaoSenhaEquipe,
  textosIguais,
  validadeDias,
  type Papel,
  type SessaoUsuario,
} from "./sessao";

export type ModoAcesso = "aberto" | "senha" | "usuarios";

/**
 * Caches deste processo. O proxy roda no mesmo processo (Node) e guarda os dele com nomes próprios
 * (__fda_modo_proxy, __fda_sessoes_proxy): limpamos junto quando algo muda, para valer na hora no
 * computador da loja. Na nuvem cada instância tem o seu, e vale o prazo curto (15–30 s).
 */
type Global = {
  __fda_modo?: { modo: ModoAcesso; ate: number };
  __fda_modo_proxy?: unknown;
  __fda_sessoes_proxy?: Map<string, unknown>;
  __fda_chave_sessao?: string;
  __fda_chave_sessao_lendo?: Promise<string>;
  __fda_chave_curta_avisada?: boolean;
  __fda_versoes?: Map<string, { info: InfoSessao | null; ate: number }>;
  __fda_validade?: { dias: number; ate: number };
};
type InfoSessao = { versao: number; ativo: boolean; nome: string; papel: Papel };
const g = globalThis as unknown as Global;
const CACHE_MS = 30_000;

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
  g.__fda_modo_proxy = undefined;
  g.__fda_sessoes_proxy?.clear();
}

/* ------------------------------------------------------------ chave das sessões */

const CHAVE_NO_BANCO = "sessao_segredo"; // tabela configuracoes; fora das configurações públicas de /api/config

/**
 * Chave HMAC que assina os cookies: SESSAO_SEGREDO do ambiente (APP_SEGREDO, o nome antigo, também
 * vale); senão uma chave aleatória de 32 bytes criada uma vez e guardada no banco. Nunca sai do
 * servidor nem deriva da APP_SENHA (não exportada de propósito). Trocar a chave desloga todo mundo.
 */
async function chaveSessao(): Promise<string> {
  const doAmbiente = process.env.SESSAO_SEGREDO || process.env.APP_SEGREDO;
  if (doAmbiente) {
    if (doAmbiente.length < 32 && !g.__fda_chave_curta_avisada) {
      g.__fda_chave_curta_avisada = true;
      console.warn("[sessao] SESSAO_SEGREDO curto: use um valor aleatório com 64 letras e números.");
    }
    return doAmbiente;
  }
  if (g.__fda_chave_sessao) return g.__fda_chave_sessao;
  const lendo = (g.__fda_chave_sessao_lendo ??= (async () => {
    const db = await getDb();
    const t = schema.configuracoes;
    const ler = async () => {
      const [linha] = await db.select().from(t).where(eq(t.chave, CHAVE_NO_BANCO));
      const v = (linha?.valor ?? null) as { segredo?: unknown } | null;
      return typeof v?.segredo === "string" && v.segredo.length >= 32 ? v.segredo : null;
    };
    let segredo = await ler();
    if (!segredo) {
      // onConflictDoNothing + nova leitura: dois processos ao mesmo tempo ficam com a mesma chave.
      const nova = { segredo: randomBytes(32).toString("hex"), criadoEm: new Date().toISOString() };
      await db.insert(t).values({ chave: CHAVE_NO_BANCO, valor: nova }).onConflictDoNothing();
      segredo = await ler();
      if (!segredo) {
        await db.update(t).set({ valor: nova }).where(eq(t.chave, CHAVE_NO_BANCO)); // linha estragada
        segredo = await ler();
      }
    }
    if (!segredo) throw new Error("Não consegui preparar a chave das sessões no banco.");
    g.__fda_chave_sessao = segredo;
    return segredo;
  })().finally(() => {
    g.__fda_chave_sessao_lendo = undefined;
  }));
  return lendo;
}

/** Validade do login (Configurações → validadeSessaoDias, padrão 14), com cache de 30 s. */
async function validadeAtual(): Promise<number> {
  if (g.__fda_validade && g.__fda_validade.ate > Date.now()) return g.__fda_validade.dias;
  const dias = validadeDias((await getConfig("sistema")).validadeSessaoDias);
  g.__fda_validade = { dias, ate: Date.now() + CACHE_MS };
  return dias;
}

/** Impressão da senha da equipe para o cookie do modo senha (muda quando a APP_SENHA muda). */
async function impressaoEquipe(): Promise<string> {
  return impressaoSenhaEquipe(process.env.APP_SENHA ?? "", await chaveSessao());
}

/* ------------------------------------------------------------ versão da sessão */

/** Versão, situação, nome e papel do usuário, com cache curto (≈30 s) em memória. */
async function infoSessao(usuarioId: string): Promise<InfoSessao | null> {
  const cache = (g.__fda_versoes ??= new Map());
  const c = cache.get(usuarioId);
  if (c && c.ate > Date.now()) return c.info;
  const db = await getDb();
  const u = schema.usuarios;
  const [linha] = await db.select({ versao: u.versaoSessao, ativo: u.ativo, nome: u.nome, papel: u.papel }).from(u).where(eq(u.id, usuarioId));
  const info: InfoSessao | null = linha ? { versao: linha.versao, ativo: linha.ativo, nome: linha.nome, papel: linha.papel === "gestora" ? "gestora" : "funcionario" } : null;
  if (cache.size > 500) cache.clear();
  cache.set(usuarioId, { info, ate: Date.now() + CACHE_MS });
  return info;
}

/** Esquece as sessões em cache deste processo (a versão de alguém subiu). */
export function esquecerSessoes(usuarioId?: string) {
  if (usuarioId) g.__fda_versoes?.delete(usuarioId);
  else g.__fda_versoes?.clear();
  g.__fda_sessoes_proxy?.clear();
}

/**
 * Sobe a versão da sessão do usuário: derruba os logins dele em todos os aparelhos.
 * Usado ao sair, desativar, trocar senha ou papel.
 */
export async function derrubarSessoes(usuarioId: string) {
  const db = await getDb();
  await db
    .update(schema.usuarios)
    .set({ versaoSessao: sql`${schema.usuarios.versaoSessao} + 1` })
    .where(eq(schema.usuarios.id, usuarioId));
  esquecerSessoes(usuarioId);
}

/* ------------------------------------------------------------ requisição */

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

/**
 * Confere o cookie: assinatura, validade e versão no banco (usuários) ou a senha da equipe (modo
 * senha). Erro no banco ou na chave propaga: quem chama nega o acesso.
 */
async function sessaoDoCookie(token: string | undefined, modo: Exclude<ModoAcesso, "aberto">): Promise<SessaoUsuario | null> {
  if (!token) return null;
  const d = conferirToken(token, await chaveSessao(), { validadeDias: await validadeAtual() });
  if (!d) return null;
  if (modo === "senha") {
    if (d.u !== "equipe" || typeof d.s !== "string" || !textosIguais(d.s, await impressaoEquipe())) return null;
    return { u: "equipe", n: "Equipe", p: "gestora", e: d.e };
  }
  if (typeof d.s !== "number" || d.u === "equipe" || d.u === "local") return null;
  const info = await infoSessao(d.u);
  if (!info || !info.ativo || info.versao !== d.s) return null;
  return { u: d.u, n: info.nome, p: info.papel, e: d.e };
}

/**
 * Usuário da requisição. No acesso livre, só o próprio computador do servidor entra (como gestora);
 * outros aparelhos ficam sem usuário.
 */
export async function usuarioDaRequisicao(req: NextRequest | Request): Promise<SessaoUsuario | null> {
  const modo = await modoAcesso();
  if (modo === "aberto") return ehLocal(req.headers) ? USUARIO_LOCAL : null;
  return sessaoDoCookie(cookieDe(req), modo);
}

export class SemPermissao extends Error {}

/** Garante o papel mínimo; lança SemPermissao (a rota responde 403). */
export async function exigirPapel(req: NextRequest | Request, papel: Papel = "funcionario"): Promise<SessaoUsuario> {
  const u = await usuarioDaRequisicao(req);
  if (!u) throw new SemPermissao((await modoAcesso()) === "aberto" ? MENSAGEM_ABERTO_REMOTO : MENSAGEM_LOGIN);
  if (papel === "gestora" && u.p !== "gestora") throw new SemPermissao(MENSAGEM_GESTORA);
  return u;
}

/**
 * Grava o cookie de login na resposta, com a validade de Configurações.
 * `versao`: usuarios.versaoSessao do usuário; na senha única da equipe, omita.
 */
export async function gravarSessao(res: NextResponse, req: NextRequest, sessao: { u: string; n: string; p: Papel; versao?: number }) {
  const dias = await validadeAtual();
  const s = sessao.versao ?? (await impressaoEquipe());
  const token = criarToken({ u: sessao.u, n: sessao.n, p: sessao.p, s }, await chaveSessao(), { validadeDias: dias });
  res.cookies.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: dias * 86400,
  });
}
