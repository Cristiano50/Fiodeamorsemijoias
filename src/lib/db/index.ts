import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { MIGRACOES } from "./migracoes";
import { backupAntesDaMigracao, backupDiarioSeNecessario, deveFazerBackupAntesDaMigracao } from "../backup";
import { pastaDados, urlArquivo } from "../pastas";

/**
 * Banco de dados:
 *  - Local (padrão): arquivo SQLite em ./dados/fiodeamor.db (ou na pasta FDA_DADOS, no instalador do Windows),
 *    em modo WAL: ler (inclusive o backup com VACUUM INTO) não trava quem grava, e vice-versa. Cada conexão espera
 *    até 5 s por um bloqueio em vez de falhar na hora com "database is locked".
 *  - Nuvem: defina DATABASE_URL=libsql://... e DATABASE_AUTH_TOKEN (Turso) — o mesmo código funciona.
 */
type Global = {
  __fda_db?: LibSQLDatabase<typeof schema>;
  __fda_client?: Client;
  __fda_local?: boolean;
  __fda_pronto?: Promise<void>;
};
const g = globalThis as unknown as Global;

/** Espera máxima (ms) por um bloqueio de outra conexão no banco local (busy_timeout). */
export const ESPERA_BANCO_OCUPADO_MS = 5000;

function criarCliente(): { client: Client; local: boolean } {
  let url = process.env.DATABASE_URL?.trim();
  if (!url) {
    const pasta = pastaDados();
    fs.mkdirSync(pasta, { recursive: true });
    url = urlArquivo(path.join(pasta, "fiodeamor.db"));
  }
  const local = url.startsWith("file:");
  // `timeout` é o busy_timeout de TODAS as conexões que o cliente abre (ele tem um pool de conexões; um
  // "PRAGMA busy_timeout" valeria só para uma delas). Só vale para arquivo local; o Turso ignora.
  const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN, ...(local ? { timeout: ESPERA_BANCO_OCUPADO_MS } : {}) });
  return { client, local };
}

/** Modo WAL (fica gravado no próprio arquivo do banco, vale para todas as conexões). */
async function prepararBancoLocal(client: Client) {
  try {
    const r = await client.execute("PRAGMA journal_mode = WAL");
    const linha = r.rows[0] as unknown as Record<string, unknown> | undefined;
    const modo = String(linha?.journal_mode ?? "").toLowerCase();
    if (modo && modo !== "wal" && modo !== "memory") console.warn(`[db] o banco continua no modo "${modo}" (o WAL não foi ativado)`);
  } catch (e) {
    console.warn("[db] não foi possível ativar o modo WAL:", e instanceof Error ? e.message : e);
  }
}

async function aplicarMigracoes(client: Client, local: boolean) {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migracoes (tag TEXT PRIMARY KEY, aplicada_em TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const feitas = new Set((await client.execute("SELECT tag FROM _migracoes")).rows.map((r) => String(r.tag)));
  const pendentes = MIGRACOES.filter((m) => !feitas.has(m.tag));
  if (!pendentes.length) return;

  // Atualização do app com mudança no banco: guarda uma cópia antes (backups/antes-da-migracao-<nº>-<data>.db).
  if (deveFazerBackupAntesDaMigracao({ local, aplicadas: feitas.size, pendentes: pendentes.length })) {
    try {
      const copia = await backupAntesDaMigracao(pendentes[0].tag);
      console.info(`[db] cópia de segurança antes de atualizar o banco: ${copia.nome}`);
    } catch (e) {
      throw new Error(
        `O banco não foi atualizado porque não deu para fazer a cópia de segurança antes da atualização: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  for (const m of pendentes) {
    const comandos = m.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await client.batch([...comandos, { sql: "INSERT INTO _migracoes (tag) VALUES (?)", args: [m.tag] }], "write");
  }
}

/** Pasta externa do backup (Configurações → sistema.backupPastaExterna), lida direto da tabela: config.ts importa este módulo. */
async function lerPastaExterna(): Promise<string> {
  const client = g.__fda_client;
  if (!client) return "";
  const r = await client.execute({ sql: "SELECT valor FROM configuracoes WHERE chave = ?", args: ["sistema"] });
  const bruto = r.rows[0]?.valor;
  if (typeof bruto !== "string") return "";
  try {
    const valor = JSON.parse(bruto) as { backupPastaExterna?: unknown } | null;
    return typeof valor?.backupPastaExterna === "string" ? valor.backupPastaExterna.trim() : "";
  } catch {
    return "";
  }
}

export async function getDb(): Promise<LibSQLDatabase<typeof schema>> {
  if (!g.__fda_client) {
    const { client, local } = criarCliente();
    g.__fda_client = client;
    g.__fda_local = local;
    g.__fda_db = drizzle(client, { schema });
  }
  if (!g.__fda_pronto) {
    const client = g.__fda_client;
    const local = !!g.__fda_local;
    const pronto = (async () => {
      if (local) await prepararBancoLocal(client);
      await aplicarMigracoes(client, local);
    })();
    g.__fda_pronto = pronto;
    // Se falhar (disco cheio, banco travado por outro programa…), a próxima requisição tenta de novo
    // em vez de ficar presa no mesmo erro até reiniciar o servidor.
    pronto.catch(() => {
      if (g.__fda_pronto === pronto) g.__fda_pronto = undefined;
    });
  }
  await g.__fda_pronto;
  // Não bloqueante: no máximo 1 backup por dia, em segundo plano, e a cópia para a pasta externa; nunca lança erro.
  void backupDiarioSeNecessario({ pastaExterna: lerPastaExterna });
  return g.__fda_db!;
}

export { schema };
