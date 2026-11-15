import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { MIGRACOES } from "../src/lib/db/migracoes";
import { urlArquivo } from "../src/lib/pastas";

/**
 * src/lib/db/index.ts num processo à parte: o módulo importa "server-only", que só carrega com a condição
 * "react-server" (como o Next faz no servidor). Cada cenário roda num processo novo, com FDA_DADOS temporária.
 */
const RAIZ = path.resolve(__dirname, "..");

function rodar(dados: string, codigo: string): Record<string, unknown> {
  const script = `
const { getDb } = await import(${JSON.stringify(path.join(RAIZ, "src", "lib", "db", "index.ts"))});
const saida = {};
${codigo}
process.stdout.write("RESULTADO " + JSON.stringify(saida) + "\\n", () => process.exit(0));
`;
  const env: NodeJS.ProcessEnv = { ...process.env, FDA_DADOS: dados, NODE_ENV: "test" };
  delete env.DATABASE_URL;
  delete env.DATABASE_AUTH_TOKEN;
  const r = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", script], { cwd: RAIZ, env, encoding: "utf8", timeout: 90000 });
  const linha = (r.stdout ?? "").split("\n").find((l) => l.startsWith("RESULTADO "));
  assert.ok(linha, `o processo não terminou o cenário (código ${r.status}):\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(linha.slice("RESULTADO ".length));
}

const temp = (nome: string) => fs.mkdtempSync(path.join(os.tmpdir(), `fda-db-${nome}-`));

test("banco local: modo WAL, espera de 5 s por bloqueio em todas as conexões e migrações aplicadas", () => {
  const dados = temp("wal");
  try {
    const r = rodar(
      dados,
      `
await getDb();
const c = globalThis.__fda_client;
saida.modo = (await c.execute("PRAGMA journal_mode")).rows[0].journal_mode;
// Duas conexões do pool: a da transação fica presa, então a consulta seguinte abre outra. As duas esperam 5 s.
const tx = await c.transaction("read");
saida.esperas = [(await tx.execute("PRAGMA busy_timeout")).rows[0].timeout, (await c.execute("PRAGMA busy_timeout")).rows[0].timeout];
tx.close();
saida.migracoes = Number((await c.execute("SELECT count(*) AS n FROM _migracoes")).rows[0].n);
`,
    );
    assert.equal(r.modo, "wal");
    assert.deepEqual(r.esperas, [5000, 5000]);
    assert.equal(r.migracoes, MIGRACOES.length);
    assert.ok(!fs.existsSync(path.join(dados, "backups")) || !fs.readdirSync(path.join(dados, "backups")).some((n) => n.startsWith("antes-da-migracao")), "banco novo não precisa de cópia");
  } finally {
    fs.rmSync(dados, { recursive: true, force: true });
  }
});

test("migração que falha não fica presa: a próxima requisição tenta de novo", async () => {
  const dados = temp("nova-tentativa");
  try {
    // _migracoes estragada (sem a coluna tag): a primeira tentativa falha.
    const c = createClient({ url: urlArquivo(path.join(dados, "fiodeamor.db")) });
    await c.execute("CREATE TABLE _migracoes (x TEXT)");
    c.close();
    const r = rodar(
      dados,
      `
const { createClient } = await import("@libsql/client");
try { await getDb(); saida.primeira = "ok"; } catch (e) { saida.primeira = String(e.message); }
const conserto = createClient({ url: "file:" + process.env.FDA_DADOS.replaceAll("\\\\", "/") + "/fiodeamor.db" });
await conserto.execute("DROP TABLE _migracoes");
conserto.close();
await getDb();
saida.migracoes = Number((await globalThis.__fda_client.execute("SELECT count(*) AS n FROM _migracoes")).rows[0].n);
`,
    );
    assert.match(String(r.primeira), /tag/);
    assert.equal(r.migracoes, MIGRACOES.length);
  } finally {
    fs.rmSync(dados, { recursive: true, force: true });
  }
});

test("atualização com migração nova: cópia antes-da-migracao-<nº>-<data>.db com os dados de antes", async () => {
  const dados = temp("antes-da-migracao");
  try {
    // Banco de uma versão antiga: só a primeira migração aplicada, com um dado.
    const c = createClient({ url: urlArquivo(path.join(dados, "fiodeamor.db")) });
    await c.execute("CREATE TABLE _migracoes (tag TEXT PRIMARY KEY, aplicada_em TEXT)");
    const [primeira] = MIGRACOES;
    for (const sql of primeira.sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await c.execute(sql);
    await c.execute({ sql: "INSERT INTO _migracoes (tag) VALUES (?)", args: [primeira.tag] });
    await c.execute({ sql: "INSERT INTO configuracoes (chave, valor) VALUES (?, ?)", args: ["marca", JSON.stringify({ nome: "Fio de Amor" })] });
    c.close();

    const r = rodar(dados, `await getDb(); saida.migracoes = Number((await globalThis.__fda_client.execute("SELECT count(*) AS n FROM _migracoes")).rows[0].n);`);
    assert.equal(r.migracoes, MIGRACOES.length);
    const copias = fs.readdirSync(path.join(dados, "backups")).filter((n) => n.startsWith("antes-da-migracao-"));
    assert.equal(copias.length, 1);
    const numero = /^(\d+)/.exec(MIGRACOES[1].tag)?.[1];
    assert.match(copias[0], new RegExp(`^antes-da-migracao-${numero}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.db$`));
    const copia = createClient({ url: urlArquivo(path.join(dados, "backups", copias[0])) });
    try {
      assert.equal(Number((await copia.execute("SELECT count(*) AS n FROM _migracoes")).rows[0].n), 1, "a cópia é do banco antes de atualizar");
      assert.equal(String((await copia.execute("SELECT valor FROM configuracoes WHERE chave = 'marca'")).rows[0].valor), JSON.stringify({ nome: "Fio de Amor" }));
    } finally {
      copia.close();
    }
  } finally {
    fs.rmSync(dados, { recursive: true, force: true });
  }
});
