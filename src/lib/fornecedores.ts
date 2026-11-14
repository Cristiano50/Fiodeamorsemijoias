import "server-only";
import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "./db";

/**
 * Fornecedores: o nome original do documento (ex.: 广州宁裕铧首饰有限公司) fica guardado nos pedidos e é ele
 * que a recompra usa. A loja pode dar um apelido (ex.: "Ningyuhua (Guangzhou)") só para exibição.
 */

/** Chave do fornecedor: o nome original sem espaços e em minúsculas (a mesma regra da recompra). */
export const chaveFornecedor = (nome: string | null | undefined) => (nome ?? "").replace(/\s+/g, "").toLowerCase();

/** Apelidos de todos os fornecedores: chave → apelido. */
export async function apelidosFornecedores(): Promise<Map<string, string>> {
  const db = await getDb();
  const linhas = await db.select({ chave: schema.fornecedores.chave, apelido: schema.fornecedores.apelido }).from(schema.fornecedores);
  return new Map(linhas.filter((l) => l.apelido).map((l) => [l.chave, l.apelido!]));
}

/** Apelido do fornecedor pelo nome original (null se não tiver). */
export const apelidoDe = (mapa: Map<string, string>, nome: string | null | undefined) => (nome ? (mapa.get(chaveFornecedor(nome)) ?? null) : null);

/** Salva o apelido (vazio = volta a mostrar só o nome original). O nome original não muda. */
export async function salvarApelido(nomeOriginal: string, apelido: string | null | undefined) {
  const original = nomeOriginal.replace(/\s+/g, " ").trim();
  const chave = chaveFornecedor(original);
  if (!chave) throw new Error("O pedido não tem o nome do fornecedor.");
  const valor = (apelido ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const db = await getDb();
  await db
    .insert(schema.fornecedores)
    .values({ chave, nomeOriginal: original, apelido: valor })
    .onConflictDoUpdate({ target: schema.fornecedores.chave, set: { apelido: valor, atualizadoEm: new Date().toISOString() } });
  return valor;
}

/** Fornecedores que aparecem nos pedidos, com o apelido e quantos pedidos cada um tem. */
export async function listarFornecedores() {
  const db = await getDb();
  const [linhas, apelidos] = await Promise.all([
    db
      .select({ nome: schema.pedidos.fornecedor, pedidos: sql<number>`count(*)`, ultimo: sql<string>`max(${schema.pedidos.dataCompra})` })
      .from(schema.pedidos)
      .groupBy(schema.pedidos.fornecedor)
      .orderBy(desc(sql`max(${schema.pedidos.dataCompra})`)),
    apelidosFornecedores(),
  ]);
  // Junta grafias que só diferem por espaços ou maiúsculas (a recompra trata como o mesmo fornecedor).
  const porChave = new Map<string, { nome: string; apelido: string | null; pedidos: number; ultimo: string | null }>();
  for (const l of linhas) {
    const chave = chaveFornecedor(l.nome);
    if (!chave) continue;
    const atual = porChave.get(chave);
    if (atual) atual.pedidos += Number(l.pedidos);
    else porChave.set(chave, { nome: l.nome!.trim(), apelido: apelidos.get(chave) ?? null, pedidos: Number(l.pedidos), ultimo: l.ultimo });
  }
  return [...porChave.values()];
}
