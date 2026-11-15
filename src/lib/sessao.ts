/**
 * Sessão do app (cookie assinado) e senhas. Sem banco e sem "server-only": usado pelo proxy, pelas
 * rotas (via auth.ts) e pelos testes (tests/seguranca-sessao.test.ts).
 *  - Sem usuários cadastrados e sem APP_SENHA: acesso livre, só no computador do servidor, como gestora.
 *  - Com APP_SENHA (sem usuários): senha única da equipe.
 *  - Com usuários cadastrados: login e senha individuais, papéis gestora/funcionario.
 *
 * O cookie leva o id do usuário, a versão da sessão (usuarios.versaoSessao; na senha única, uma
 * impressão da senha) e a data de emissão. A assinatura usa a chave das sessões (ver chaveSessao em
 * auth.ts: SESSAO_SEGREDO ou uma chave aleatória guardada no banco), nunca a APP_SENHA.
 */
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const COOKIE_SESSAO = "fda_sessao";
export type Papel = "gestora" | "funcionario";
export interface SessaoUsuario {
  u: string; // id do usuário ("equipe" na senha única, "local" no acesso livre)
  n: string; // nome
  p: Papel;
  e: number; // expira (ms)
}

/** Conteúdo do cookie (formato 2). */
export interface DadosSessao {
  v: 2;
  u: string;
  n: string;
  p: Papel;
  s: number | string; // versão da sessão do usuário, ou impressão da senha da equipe
  i: number; // emitido em (ms)
  e: number; // expira em (ms), pela validade do momento do login
}

const DIA = 86_400_000;
const FOLGA_RELOGIO = 5 * 60_000;
export const VALIDADE_PADRAO_DIAS = 14;

/** Validade do login em dias (Configurações → validadeSessaoDias): de 1 a 365; valor inválido → 14. */
export function validadeDias(valor: unknown): number {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 365) : VALIDADE_PADRAO_DIAS;
}

const assinar = (dados: string, chave: string) => createHmac("sha256", chave).update(dados).digest("base64url");

export function criarToken(
  sessao: { u: string; n: string; p: Papel; s: number | string },
  chave: string,
  opts: { validadeDias: number; agora?: number },
): string {
  const agora = opts.agora ?? Date.now();
  const corpo: DadosSessao = { v: 2, u: sessao.u, n: sessao.n, p: sessao.p, s: sessao.s, i: agora, e: agora + validadeDias(opts.validadeDias) * DIA };
  const dados = Buffer.from(JSON.stringify(corpo), "utf8").toString("base64url");
  return `${dados}.${assinar(dados, chave)}`;
}

function decodificar(dados: string): DadosSessao | null {
  try {
    const d = JSON.parse(Buffer.from(dados, "base64url").toString("utf8")) as DadosSessao;
    const ok =
      d &&
      d.v === 2 &&
      typeof d.u === "string" &&
      d.u.length > 0 &&
      d.u.length <= 100 &&
      typeof d.n === "string" &&
      d.n.length <= 200 &&
      (d.p === "gestora" || d.p === "funcionario") &&
      (typeof d.s === "number" || typeof d.s === "string") &&
      Number.isFinite(d.i) &&
      Number.isFinite(d.e);
    return ok ? d : null;
  } catch {
    return null;
  }
}

/**
 * Lê o conteúdo SEM conferir a assinatura. Só para o proxy descartar cookies vencidos ou estranhos sem
 * perguntar ao servidor; quem decide se a sessão vale é conferirToken (com a chave, no servidor).
 */
export function lerSemConferir(token: string | undefined | null): DadosSessao | null {
  if (!token || token.length > 4096) return null;
  const partes = token.split(".");
  return partes.length === 2 ? decodificar(partes[0]) : null;
}

/**
 * Confere assinatura e validade: vence no que vier primeiro entre a validade do momento do login e a
 * validade atual (diminuir a validade em Configurações vale também para quem já entrou).
 * A versão da sessão é conferida por quem chama (auth.ts), no banco.
 */
export function conferirToken(token: string | undefined | null, chave: string, opts: { validadeDias: number; agora?: number }): DadosSessao | null {
  if (!token || token.length > 4096 || !chave) return null;
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [dados, sig] = partes;
  const recebida = Buffer.from(sig);
  const esperada = Buffer.from(assinar(dados, chave));
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  const d = decodificar(dados);
  if (!d) return null;
  const agora = opts.agora ?? Date.now();
  const vence = Math.min(d.e, d.i + validadeDias(opts.validadeDias) * DIA);
  if (d.i > agora + FOLGA_RELOGIO || vence <= agora) return null;
  return { ...d, e: vence };
}

/** Comparação em tempo constante (também para tamanhos diferentes). */
export function textosIguais(a: string, b: string): boolean {
  const x = createHash("sha256").update(a, "utf8").digest();
  const y = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(x, y);
}

/** Impressão da senha da equipe (modo senha) guardada no cookie: trocar a APP_SENHA derruba os logins. */
export function impressaoSenhaEquipe(senha: string, chave: string): string {
  return createHmac("sha256", chave).update(`senha-da-equipe:${senha}`).digest("base64url").slice(0, 22);
}

/* ------------------------------------------------------------ senhas */

export const SENHA_MINIMA = 8;
/** Mensagem quando a senha nova é curta demais (usuários antigos com senha curta continuam entrando). */
export function problemaSenhaNova(senha: unknown): string | null {
  if (typeof senha !== "string" || senha.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (senha.length > 200) return "A senha pode ter no máximo 200 caracteres.";
  return null;
}

// scrypt assíncrono: o scryptSync travava o servidor inteiro a cada login.
const scryptAsync = (senha: string, sal: string) =>
  new Promise<Buffer>((resolve, reject) => scrypt(senha, sal, 64, (e, chave) => (e ? reject(e) : resolve(chave))));

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16).toString("hex");
  return `scrypt$${sal}$${(await scryptAsync(senha, sal)).toString("hex")}`;
}

export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const [alg, sal, h] = (hash ?? "").split("$");
  if (alg !== "scrypt" || !sal || !h) {
    await scryptAsync(senha, "fda-sal-ficticio"); // mesmo tempo de resposta
    return false;
  }
  const calc = await scryptAsync(senha, sal);
  const ref = Buffer.from(h, "hex");
  return calc.length === ref.length && timingSafeEqual(calc, ref);
}

let ficticio: Promise<string> | null = null;
/** Hash de uma senha aleatória: conferido quando o login não existe, para a resposta demorar o mesmo. */
export function hashFicticio(): Promise<string> {
  ficticio ??= hashSenha(randomBytes(16).toString("hex")).catch((e) => {
    ficticio = null;
    throw e;
  });
  return ficticio;
}

export const USUARIO_LOCAL: SessaoUsuario = { u: "local", n: "Acesso local", p: "gestora", e: Number.MAX_SAFE_INTEGER };
