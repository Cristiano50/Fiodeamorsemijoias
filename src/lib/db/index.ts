import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { MIGRACOES } from "./migracoes";
import { backupDiarioSeNecessario } from "../backup";
import { pastaDados, urlArquivo } from "../pastas";

/**
 * Banco de dados:
 *  - Local (padrão): arquivo SQLite em ./dados/fiodeamor.db (ou na pasta FDA_DADOS, no instalador do Windows)
 *  - Nuvem: defina DATABASE_URL=libsql://... e DATABASE_AUTH_TOKEN (Turso) — o mesmo código funciona.
 */
type Global = { __fda_db?: LibSQLDatabase<typeof schema>; __fda_client?: Client; __fda_pronto?: Promise<void> };
const g = globalThis as unknown as Global;

function criarCliente(): Client {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const pasta = pastaDados();
    fs.mkdirSync(pasta, { recursive: true });
    url = urlArquivo(path.join(pasta, "fiodeamor.db"));
  }
  return createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
}

async function aplicarMigracoes(client: Client) {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migracoes (tag TEXT PRIMARY KEY, aplicada_em TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  );
  const feitas = new Set((await client.execute("SELECT tag FROM _migracoes")).rows.map((r) => String(r.tag)));
  for (const m of MIGRACOES) {
    if (feitas.has(m.tag)) continue;
    const comandos = m.sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    await client.batch([...comandos, { sql: "INSERT INTO _migracoes (tag) VALUES (?)", args: [m.tag] }], "write");
  }
}

export async function getDb(): Promise<LibSQLDatabase<typeof schema>> {
  if (!g.__fda_client) {
    g.__fda_client = criarCliente();
    g.__fda_db = drizzle(g.__fda_client, { schema });
    g.__fda_pronto = aplicarMigracoes(g.__fda_client);
  }
  await g.__fda_pronto;
  void backupDiarioSeNecessario(); // não bloqueante: no máximo 1 vez por dia, em segundo plano, nunca lança erro
  return g.__fda_db!;
}

export { schema };
