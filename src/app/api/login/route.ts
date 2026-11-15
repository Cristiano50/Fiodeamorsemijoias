import { NextRequest, NextResponse } from "next/server";
import { eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { derrubarSessoes, gravarSessao, modoAcesso, usuarioDaRequisicao } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { MENSAGEM_ABERTO_REMOTO } from "@/lib/acesso";
import { aposFalha, chavesTentativa, mensagemBloqueio, restanteMs, type Tentativa } from "@/lib/login-limite";
import { ehLocal, ipInformado } from "@/lib/rede";
import { COOKIE_SESSAO, conferirSenha, hashFicticio, textosIguais, type Papel } from "@/lib/sessao";

const t = schema.tentativasLogin;

async function lerTentativas(chaves: string[]): Promise<Map<string, Tentativa>> {
  const db = await getDb();
  const linhas = await db.select().from(t).where(inArray(t.chave, chaves));
  return new Map(linhas.map((l) => [l.chave, l]));
}

/** Soma mais uma falha em cada chave (IP e login); devolve o maior bloqueio que começou agora. */
async function contarFalha(chaves: string[], atuais: Map<string, Tentativa>, agora: number): Promise<number> {
  const db = await getDb();
  let bloqueio = 0;
  for (const chave of chaves) {
    const novo = aposFalha(atuais.get(chave), agora);
    await db.insert(t).values({ chave, ...novo }).onConflictDoUpdate({ target: t.chave, set: novo });
    bloqueio = Math.max(bloqueio, restanteMs(novo, agora));
  }
  // Limpeza: tentativas paradas há mais de 7 dias (a tabela fica pequena).
  await db.delete(t).where(lt(t.atualizadoEm, new Date(agora - 7 * 86_400_000).toISOString()));
  return bloqueio;
}

async function zerarTentativas(chaves: string[]) {
  const db = await getDb();
  await db.delete(t).where(inArray(t.chave, chaves));
}

/**
 * POST { login?, senha } — entra com usuário e senha (ou a senha única da equipe).
 * Limite por IP e por login (5 falhas → 1 min, 10 → 15 min, 20 → 1 h; zera ao entrar). As falhas vão
 * para o histórico com o login e o IP, nunca com a senha.
 */
export async function POST(req: NextRequest) {
  try {
    const corpo = (await req.json().catch(() => ({}))) as { login?: unknown; senha?: unknown };
    const login = String(corpo.login ?? "").trim().toLowerCase().slice(0, 100);
    const senha = typeof corpo.senha === "string" ? corpo.senha : "";
    const modo = await modoAcesso();
    if (modo === "aberto") {
      if (!ehLocal(req.headers)) return NextResponse.json({ erro: MENSAGEM_ABERTO_REMOTO }, { status: 403 });
      return NextResponse.json({ ok: true });
    }

    const ip = ipInformado(req.headers);
    const quem = modo === "senha" ? "(senha da equipe)" : login;
    const chaves = chavesTentativa(ip, quem);
    const agora = Date.now();
    const atuais = await lerTentativas(chaves);
    const espera = Math.max(...chaves.map((c) => restanteMs(atuais.get(c), agora)));
    const bloqueado = (ms: number, texto: string) => NextResponse.json({ erro: texto }, { status: 429, headers: { "Retry-After": String(Math.ceil(ms / 1000)) } });
    if (espera > 0) return bloqueado(espera, mensagemBloqueio(espera));

    const falha = async (usuarioId: string | null) => {
      const bloqueio = await contarFalha(chaves, atuais, agora);
      await registrar(
        null,
        {
          acao: "login.falha",
          entidade: "usuario",
          entidadeId: usuarioId,
          resumo: `Tentativa de login sem sucesso: ${quem ? `"${quem}"` : "login vazio"}, IP ${ip ?? "desconhecido"}${bloqueio ? " (bloqueado por um tempo)" : ""}`,
          dados: { login: quem, ip, bloqueadoMs: bloqueio || undefined },
        },
        { u: null, n: "Tentativa de login" },
      );
      await new Promise((r) => setTimeout(r, 800));
      if (bloqueio) return bloqueado(bloqueio, `Usuário ou senha incorretos. ${mensagemBloqueio(bloqueio)}`);
      return NextResponse.json({ erro: "Usuário ou senha incorretos" }, { status: 401 });
    };
    if (senha.length > 200) return falha(null);

    if (modo === "senha") {
      if (!textosIguais(senha, process.env.APP_SENHA ?? "")) return falha(null);
      await zerarTentativas(chaves);
      const res = NextResponse.json({ ok: true, usuario: { nome: "Equipe", papel: "gestora" } });
      await gravarSessao(res, req, { u: "equipe", n: "Equipe", p: "gestora" });
      return res;
    }

    const db = await getDb();
    const [u] = login ? await db.select().from(schema.usuarios).where(eq(schema.usuarios.login, login)) : [];
    // Confere sempre um hash (o do usuário ou um fictício): o tempo de resposta não revela se o login existe.
    const certa = await conferirSenha(senha, u?.senhaHash ?? (await hashFicticio()));
    if (!u || !u.ativo || !certa) return falha(u?.id ?? null);
    await zerarTentativas(chaves);
    const papel: Papel = u.papel === "gestora" ? "gestora" : "funcionario";
    const res = NextResponse.json({ ok: true, usuario: { nome: u.nome, papel } });
    await gravarSessao(res, req, { u: u.id, n: u.nome, p: papel, versao: u.versaoSessao });
    await registrar(null, { acao: "login", entidade: "usuario", entidadeId: u.id, resumo: `${u.nome} entrou no app` }, { u: u.id, n: u.nome });
    return res;
  } catch (e) {
    console.error("[login]", e);
    return NextResponse.json({ erro: "Não deu para entrar agora. Tente de novo em instantes." }, { status: 500 });
  }
}

/**
 * Sair: apaga o cookie e, com login individual, derruba esse login em TODOS os aparelhos
 * (a versão da sessão do usuário sobe). Na senha única da equipe, só sai deste aparelho.
 */
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_SESSAO);
  try {
    const u = await usuarioDaRequisicao(req);
    if (u && u.u !== "local" && u.u !== "equipe") {
      await derrubarSessoes(u.u);
      await registrar(null, { acao: "logout", entidade: "usuario", entidadeId: u.u, resumo: `${u.n} saiu do app (em todos os aparelhos)` }, { u: u.u, n: u.n });
    }
  } catch (e) {
    console.error("[login] sair", e);
  }
  return res;
}
