import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { erro, ok } from "@/lib/api";
import { exigirPapel, limparCacheModo, modoAcesso } from "@/lib/auth";
import { registrar } from "@/lib/historico";
import { COOKIE_SESSAO, criarToken, hashSenha, type Papel } from "@/lib/sessao";
import { novoId } from "@/lib/servicos";

const semSenha = ({ senhaHash: _s, ...u }: typeof schema.usuarios.$inferSelect) => u;

export async function GET(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const db = await getDb();
    const lista = await db.select().from(schema.usuarios).orderBy(asc(schema.usuarios.nome));
    return ok(lista.map(semSenha));
  } catch (e) {
    return erro(e);
  }
}

/**
 * Cria usuário. O PRIMEIRO usuário (quando ainda não há nenhum) vira gestora e já entra logado;
 * a partir daí o app passa a exigir login.
 */
export async function POST(req: NextRequest) {
  try {
    const { nome, login, senha, papel } = (await req.json()) as { nome: string; login: string; senha: string; papel?: Papel };
    if (!nome?.trim() || !login?.trim() || !senha || senha.length < 6) return erro("Preencha nome, login e uma senha com pelo menos 6 caracteres.", 400);
    const primeiro = (await modoAcesso()) !== "usuarios";
    if (!primeiro) await exigirPapel(req, "gestora");
    const db = await getDb();
    const id = novoId();
    const papelFinal: Papel = primeiro ? "gestora" : papel === "gestora" ? "gestora" : "funcionario";
    try {
      await db.insert(schema.usuarios).values({ id, nome: nome.trim(), login: login.trim().toLowerCase(), senhaHash: hashSenha(senha), papel: papelFinal });
    } catch {
      return erro("Esse login já existe.", 409);
    }
    limparCacheModo();
    await registrar(req, { acao: "usuario.criar", entidade: "usuario", entidadeId: id, resumo: `Usuário ${nome.trim()} (${papelFinal}) criado` });
    if (primeiro) {
      const res = NextResponse.json({ id, primeiro: true });
      res.cookies.set(COOKIE_SESSAO, criarToken({ u: id, n: nome.trim(), p: "gestora" }), {
        httpOnly: true,
        sameSite: "lax",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
    return ok({ id });
  } catch (e) {
    return erro(e);
  }
}

/** PATCH { id, nome?, papel?, ativo?, senha? } */
export async function PATCH(req: NextRequest) {
  try {
    await exigirPapel(req, "gestora");
    const { id, nome, papel, ativo, senha } = (await req.json()) as { id: string; nome?: string; papel?: Papel; ativo?: boolean; senha?: string };
    const db = await getDb();
    const [alvo] = await db.select().from(schema.usuarios).where(eq(schema.usuarios.id, id));
    if (!alvo) return erro("Usuário não encontrado", 404);
    const perdeGestora = alvo.papel === "gestora" && ((papel && papel !== "gestora") || ativo === false);
    if (perdeGestora) {
      const outras = await db
        .select({ id: schema.usuarios.id })
        .from(schema.usuarios)
        .where(and(eq(schema.usuarios.papel, "gestora"), eq(schema.usuarios.ativo, true), ne(schema.usuarios.id, id)));
      if (!outras.length) return erro("Precisa existir pelo menos uma gestora ativa.", 400);
    }
    if (senha !== undefined && senha.length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.", 400);
    const set: Partial<typeof schema.usuarios.$inferInsert> = {};
    if (nome) set.nome = nome.trim();
    if (papel) set.papel = papel;
    if (ativo !== undefined) set.ativo = ativo;
    if (senha) set.senhaHash = hashSenha(senha);
    await db.update(schema.usuarios).set(set).where(eq(schema.usuarios.id, id));
    await registrar(req, {
      acao: "usuario.alterar",
      entidade: "usuario",
      entidadeId: id,
      resumo: `Usuário ${alvo.nome}: ${[nome && "nome", papel && `papel ${papel}`, ativo !== undefined && (ativo ? "reativado" : "desativado"), senha && "senha trocada"].filter(Boolean).join(", ")}`,
    });
    return ok();
  } catch (e) {
    return erro(e);
  }
}
