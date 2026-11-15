import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { derrubarSessoes, esquecerSessoes, exigirPapel, gravarSessao, limparCacheModo, modoAcesso } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { hashSenha, problemaSenhaNova, type Papel } from "@/lib/sessao";
import { novoId } from "@/lib/servicos";

/** Só o que a tela precisa (nunca o hash da senha nem a versão da sessão). */
const paraTela = (u: typeof schema.usuarios.$inferSelect) => ({ id: u.id, nome: u.nome, login: u.login, papel: u.papel, ativo: u.ativo, criadoEm: u.criadoEm });

export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const db = await getDb();
    const lista = await db.select().from(schema.usuarios).orderBy(asc(schema.usuarios.nome));
    return ok(lista.map(paraTela));
  } catch (e) {
    return erro(e);
  }
}

/**
 * Cria usuário. O PRIMEIRO usuário (quando ainda não há nenhum) vira gestora e já entra logado;
 * a partir daí o app passa a exigir login. Senha nova: pelo menos 8 caracteres.
 */
export async function POST(req: NextRequest) {
  try {
    const { nome, login, senha, papel } = (await req.json()) as { nome?: string; login?: string; senha?: string; papel?: Papel };
    if (!nome?.trim() || !login?.trim()) return erro("Preencha nome, login e senha.", 400);
    const problema = problemaSenhaNova(senha);
    if (problema) return erro(problema, 400);
    const loginFinal = login.trim().toLowerCase();
    if (!/^\S{1,60}$/.test(loginFinal)) return erro("O login não pode ter espaços (até 60 letras).", 400);
    // Primeiro usuário: só quem já tem acesso de gestora (o computador do servidor no acesso livre ou a senha da equipe).
    await exigirPapel(req, "gestora");
    const primeiro = (await modoAcesso()) !== "usuarios";
    const db = await getDb();
    const id = novoId();
    const papelFinal: Papel = primeiro ? "gestora" : papel === "gestora" ? "gestora" : "funcionario";
    try {
      await db.insert(schema.usuarios).values({ id, nome: nome.trim(), login: loginFinal, senhaHash: await hashSenha(senha!), papel: papelFinal });
    } catch {
      return erro("Esse login já existe.", 409);
    }
    limparCacheModo();
    await registrar(req, { acao: "usuario.criar", entidade: "usuario", entidadeId: id, resumo: `Usuário ${nome.trim()} (${papelFinal}) criado` });
    if (primeiro) {
      const res = NextResponse.json({ id, primeiro: true });
      await gravarSessao(res, req, { u: id, n: nome.trim(), p: "gestora", versao: 1 });
      return res;
    }
    return ok({ id });
  } catch (e) {
    return erro(e);
  }
}

/**
 * PATCH { id, nome?, papel?, ativo?, senha?, desconectar? }
 * Desativar, trocar o papel, trocar a senha ou "desconectar" derruba os logins da pessoa em todos os
 * aparelhos (a versão da sessão sobe). Quem troca a própria senha continua logada neste aparelho.
 */
export async function PATCH(req: NextRequest) {
  try {
    const eu = await exigirPapel(req, "gestora");
    const { id, nome, papel, ativo, senha, desconectar } = (await req.json()) as {
      id: string;
      nome?: string;
      papel?: Papel;
      ativo?: boolean;
      senha?: string;
      desconectar?: boolean;
    };
    const db = await getDb();
    const [alvo] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, id));
    if (!alvo) return erro("Usuário não encontrado", 404);
    if (papel !== undefined && papel !== "gestora" && papel !== "funcionario") return erro("Papel inválido.", 400);
    const perdeGestora = alvo.papel === "gestora" && ((papel && papel !== "gestora") || ativo === false);
    if (perdeGestora) {
      const outras = await db
        .select({ id: schema.usuarios.id })
        .from(schema.usuarios)
        .where(and(eq(schema.usuarios.papel, "gestora"), eq(schema.usuarios.ativo, true), ne(schema.usuarios.id, id)));
      if (!outras.length) return erro("Precisa existir pelo menos uma gestora ativa.", 400);
    }
    if (senha !== undefined) {
      const problema = problemaSenhaNova(senha);
      if (problema) return erro(problema, 400);
    }
    const set: Partial<typeof schema.usuarios.$inferInsert> = {};
    if (nome?.trim()) set.nome = nome.trim();
    if (papel) set.papel = papel;
    if (ativo !== undefined) set.ativo = ativo;
    if (senha) set.senhaHash = await hashSenha(senha);
    if (Object.keys(set).length) await db.update(schema.usuarios).set(set).where(eq(schema.usuarios.id, id));

    const trocouPapel = !!papel && papel !== alvo.papel;
    const derrubar = !!senha || trocouPapel || ativo === false || desconectar === true;
    if (derrubar) await derrubarSessoes(id);
    else esquecerSessoes(id); // nome novo aparece na hora

    // Quem fez vai explícito: a sessão da própria gestora pode ter acabado de cair.
    await registrar(req, {
      acao: "usuario.alterar",
      entidade: "usuario",
      entidadeId: id,
      resumo: `Usuário ${alvo.nome}: ${[
        nome?.trim() && "nome",
        trocouPapel && `papel ${papel}`,
        ativo !== undefined && ativo !== alvo.ativo && (ativo ? "reativado" : "desativado"),
        senha && "senha trocada",
        derrubar && "desconectado dos aparelhos",
      ]
        .filter(Boolean)
        .join(", ") || "sem mudanças"}`,
    }, { u: eu.u, n: eu.n });

    // Trocou a própria senha: segue logada aqui (os outros aparelhos saem).
    if (senha && eu.u === id && !trocouPapel && ativo !== false) {
      const [atual] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, id));
      const res = NextResponse.json({ ok: true });
      if (atual) await gravarSessao(res, req, { u: id, n: atual.nome, p: atual.papel === "gestora" ? "gestora" : "funcionario", versao: atual.versaoSessao });
      return res;
    }
    return ok({ ok: true, voceSaiu: derrubar && eu.u === id });
  } catch (e) {
    return erro(e);
  }
}
