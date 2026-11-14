import "server-only";
import { getDb, schema } from "./db";
import { usuarioDaRequisicao } from "./auth";

/** Registra uma alteração no histórico (quem fez, o quê, antes/depois). Nunca derruba a operação. */
export async function registrar(
  req: Request | null,
  dados: { acao: string; entidade?: string; entidadeId?: string | null; resumo: string; dados?: Record<string, unknown> },
) {
  try {
    const u = req ? await usuarioDaRequisicao(req) : null;
    const db = await getDb();
    await db.insert(schema.historico).values({
      usuarioId: u?.u ?? null,
      usuarioNome: u?.n ?? "sistema",
      acao: dados.acao,
      entidade: dados.entidade ?? null,
      entidadeId: dados.entidadeId ?? null,
      resumo: dados.resumo,
      dados: dados.dados,
    });
  } catch (e) {
    console.error("[historico]", e);
  }
}
