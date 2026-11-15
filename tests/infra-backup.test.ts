import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import {
  ARQUIVO_COPIA_EXTERNA,
  ARQUIVO_ESTADO_DIARIO,
  EspacoInsuficiente,
  EXPLICACAO_LOCALSERVICE,
  MANTER_COPIAS_EXTERNAS,
  backupAntesDaMigracao,
  caminhoDoBackup,
  conferirBackupDiario,
  conferirEspacoLivre,
  copiarParaPastaExterna,
  deveFazerBackupAntesDaMigracao,
  escolherParaApagar,
  espacoMinimoParaBackup,
  estadoBackup,
  explicarErroDaPasta,
  fazerBackup,
  lerCopiaExterna,
  lerEstadoDiario,
  listarBackups,
  mesmaPasta,
  nomeDoBackup,
  numeroDaMigracao,
  ordenarBackups,
  pastaBackups,
  testarPastaExterna,
  tipoDoBackup,
} from "../src/lib/backup";
import { urlArquivo } from "../src/lib/pastas";

/** Pasta de dados temporária (FDA_DADOS) com um banco local de verdade, em modo WAL. */
async function ambiente(nome: string) {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), `fda-backup-${nome}-`));
  const antes = { dados: process.env.FDA_DADOS, url: process.env.DATABASE_URL };
  process.env.FDA_DADOS = dados;
  delete process.env.DATABASE_URL;
  (globalThis as { __fda_backup?: unknown }).__fda_backup = undefined; // estado do backup automático
  const banco = path.join(dados, "fiodeamor.db");
  const db: Client = createClient({ url: urlArquivo(banco) });
  await db.execute("PRAGMA journal_mode = WAL");
  await db.execute("CREATE TABLE pecas (id INTEGER PRIMARY KEY, nome TEXT, foto BLOB)");
  return {
    dados,
    banco,
    db,
    fim() {
      db.close();
      if (antes.dados === undefined) delete process.env.FDA_DADOS;
      else process.env.FDA_DADOS = antes.dados;
      if (antes.url !== undefined) process.env.DATABASE_URL = antes.url;
      fs.rmSync(dados, { recursive: true, force: true });
    },
  };
}

const contar = async (arquivo: string) => {
  const c = createClient({ url: urlArquivo(arquivo) });
  try {
    return Number((await c.execute("SELECT count(*) AS n FROM pecas")).rows[0].n);
  } finally {
    c.close();
  }
};

test("nomes e tipos: diário, manual e antes da migração; ordem cronológica e rotação por tipo", () => {
  const d = new Date(2026, 10, 15, 9, 30);
  assert.equal(nomeDoBackup("diario", d), "fiodeamor-2026-11-15-0930.db");
  assert.equal(nomeDoBackup("manual", d), "fiodeamor-manual-2026-11-15-0930.db");
  assert.equal(nomeDoBackup("antes-da-migracao", d, "0007_nova_coluna"), "antes-da-migracao-0007-2026-11-15-0930.db");
  assert.equal(numeroDaMigracao("0012_x"), "0012");
  assert.equal(tipoDoBackup("fiodeamor-2026-11-15-0930-2.db"), "diario");
  assert.equal(tipoDoBackup("fiodeamor-manual-2026-11-15-0930.db"), "manual");
  assert.equal(tipoDoBackup("antes-da-migracao-0007-2026-11-15-0930.db"), "antes-da-migracao");
  for (const ruim of ["fiodeamor.db", "../fiodeamor-2026-11-15-0930.db", "fiodeamor-2026-11-15-0930.db.tmp", ".copia-externa.json", "notas.txt"]) assert.equal(tipoDoBackup(ruim), null, ruim);

  const nomes = [
    "fiodeamor-2026-11-13-0900.db",
    "fiodeamor-manual-2026-11-14-1000.db",
    "fiodeamor-2026-11-15-0930.db",
    "fiodeamor-2026-11-15-0930-2.db",
    "antes-da-migracao-0006-2026-11-12-0800.db",
  ];
  assert.deepEqual(
    ordenarBackups(nomes.map((nome) => ({ nome }))).map((b) => b.nome),
    ["fiodeamor-2026-11-15-0930-2.db", "fiodeamor-2026-11-15-0930.db", "fiodeamor-manual-2026-11-14-1000.db", "fiodeamor-2026-11-13-0900.db", "antes-da-migracao-0006-2026-11-12-0800.db"],
  );
  // A rotação dos diários não apaga manual nem o "antes da migração" (e vice-versa).
  assert.deepEqual(escolherParaApagar(nomes, "diario", 2), ["fiodeamor-2026-11-13-0900.db"]);
  assert.deepEqual(escolherParaApagar(nomes, "manual", 1), []);
  assert.deepEqual(escolherParaApagar(nomes, "manual", 0), ["fiodeamor-manual-2026-11-14-1000.db"]);

  assert.equal(deveFazerBackupAntesDaMigracao({ local: true, aplicadas: 6, pendentes: 1 }), true);
  assert.equal(deveFazerBackupAntesDaMigracao({ local: true, aplicadas: 0, pendentes: 7 }), false); // banco novo, vazio
  assert.equal(deveFazerBackupAntesDaMigracao({ local: false, aplicadas: 6, pendentes: 1 }), false); // Turso
  assert.equal(deveFazerBackupAntesDaMigracao({ local: true, aplicadas: 7, pendentes: 0 }), false);
});

test("espaço livre: precisa de 2× o banco + 50 MB, senão não faz e explica", async () => {
  const a = await ambiente("espaco");
  try {
    await a.db.execute({ sql: "INSERT INTO pecas (nome, foto) VALUES (?, ?)", args: ["brinco", new Uint8Array(200_000)] });
    const tamanho = fs.statSync(a.banco).size + fs.statSync(`${a.banco}-wal`).size;
    assert.equal(espacoMinimoParaBackup(1000), 2000 + 50 * 1024 * 1024);
    const disco = (livre: number) => async () => ({ bavail: livre, bsize: 1 });
    await conferirEspacoLivre(a.banco, a.dados, disco(espacoMinimoParaBackup(tamanho) + 1));
    await assert.rejects(conferirEspacoLivre(a.banco, a.dados, disco(10 * 1024 * 1024)), (e) => e instanceof EspacoInsuficiente && /2 vezes o banco/.test(e.message));
    await assert.rejects(fazerBackup("manual", { statfs: disco(1024) }), EspacoInsuficiente);
    assert.deepEqual(await listarBackups(), []);
    // Sem como medir o disco: tenta mesmo assim.
    await conferirEspacoLivre(a.banco, a.dados, async () => Promise.reject(new Error("statfs indisponível")));
  } finally {
    a.fim();
  }
});

test("WAL: o backup leva o que ainda está no -wal e não trava quem grava durante a cópia", async () => {
  const a = await ambiente("wal");
  try {
    const foto = new Uint8Array(4096).fill(7);
    for (let i = 0; i < 1500; i++) await a.db.execute({ sql: "INSERT INTO pecas (nome, foto) VALUES (?, ?)", args: [`peça ${i}`, foto] });
    assert.ok(fs.statSync(`${a.banco}-wal`).size > 0, "os dados ainda estão no arquivo -wal");

    // Grava sem parar enquanto o backup roda (sem espera por bloqueio: em modo WAL não pode dar "database is locked").
    let rodando = true;
    let gravadas = 0;
    const gravando = (async () => {
      while (rodando) {
        await a.db.execute({ sql: "INSERT INTO pecas (nome) VALUES (?)", args: ["durante o backup"] });
        gravadas++;
        await new Promise((r) => setImmediate(r));
      }
    })();
    const b = await fazerBackup("manual");
    rodando = false;
    await gravando;

    assert.equal(b.tipo, "manual");
    assert.match(b.nome, /^fiodeamor-manual-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.db$/);
    assert.ok(gravadas > 0, "gravou durante o backup");
    assert.ok((await contar(b.caminho)) >= 1500, "a cópia tem as linhas que estavam só no -wal");
    assert.equal(caminhoDoBackup(b.nome), b.caminho);
    assert.equal(caminhoDoBackup("../fiodeamor.db"), null);
    assert.equal((await estadoBackup()).ultimoBackup?.nome, b.nome); // o Painel mostra este
  } finally {
    a.fim();
  }
});

test("rotação: 14 diários, 20 manuais e 3 antes da migração, cada tipo sem apagar os outros", async () => {
  const a = await ambiente("rotacao");
  try {
    await a.db.execute({ sql: "INSERT INTO pecas (nome) VALUES (?)", args: ["anel"] });
    const pasta = pastaBackups();
    fs.mkdirSync(pasta, { recursive: true });
    for (let dia = 1; dia <= 16; dia++) fs.writeFileSync(path.join(pasta, `fiodeamor-2026-10-${String(dia).padStart(2, "0")}-0900.db`), "velho");
    for (let dia = 1; dia <= 3; dia++) fs.writeFileSync(path.join(pasta, `fiodeamor-manual-2026-09-${String(dia).padStart(2, "0")}-0900.db`), "velho");
    for (let n = 1; n <= 4; n++) fs.writeFileSync(path.join(pasta, `antes-da-migracao-000${n}-2026-08-0${n}-0900.db`), "velho");
    fs.writeFileSync(path.join(pasta, "minhas-notas.txt"), "não é backup");

    await fazerBackup("diario");
    const porTipo = async () => {
      const l = await listarBackups();
      return { diario: l.filter((b) => b.tipo === "diario").length, manual: l.filter((b) => b.tipo === "manual").length, migracao: l.filter((b) => b.tipo === "antes-da-migracao").length };
    };
    assert.deepEqual(await porTipo(), { diario: 14, manual: 3, migracao: 4 });
    assert.ok(!fs.existsSync(path.join(pasta, "fiodeamor-2026-10-01-0900.db")) && !fs.existsSync(path.join(pasta, "fiodeamor-2026-10-02-0900.db")) && !fs.existsSync(path.join(pasta, "fiodeamor-2026-10-03-0900.db")));

    const m = await backupAntesDaMigracao("0007_teste");
    assert.match(m.nome, /^antes-da-migracao-0007-/);
    assert.deepEqual(await porTipo(), { diario: 14, manual: 3, migracao: 3 });
    assert.equal(await contar(m.caminho), 1);
    assert.ok(fs.existsSync(path.join(pasta, "minhas-notas.txt")));
  } finally {
    a.fim();
  }
});

test("cópia externa: copia, guarda só as 14 mais recentes (sem tocar em outros arquivos) e registra sucesso e falha", async () => {
  const a = await ambiente("externa");
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), "fda-pendrive-"));
  try {
    await a.db.execute({ sql: "INSERT INTO pecas (nome) VALUES (?)", args: ["colar"] });
    const b = await fazerBackup("diario");
    const externa = path.join(fora, "Backup Fio de Amor");
    fs.mkdirSync(externa);
    for (let dia = 1; dia <= 16; dia++) fs.writeFileSync(path.join(externa, `fiodeamor-2026-10-${String(dia).padStart(2, "0")}-0900.db`), "velho");
    fs.writeFileSync(path.join(externa, "planilha da loja.xlsx"), "da dona");

    const r = await copiarParaPastaExterna(b.caminho, externa);
    assert.equal(r.arquivo, b.nome);
    assert.equal(r.erro, null);
    assert.equal(await contar(path.join(externa, b.nome)), 1);
    const backups = fs.readdirSync(externa).filter((n) => tipoDoBackup(n) === "diario");
    assert.equal(backups.length, MANTER_COPIAS_EXTERNAS);
    assert.ok(backups.includes(b.nome));
    assert.ok(fs.existsSync(path.join(externa, "planilha da loja.xlsx")));
    assert.ok(!fs.readdirSync(externa).some((n) => n.endsWith(".parcial")));
    const registro = await lerCopiaExterna();
    assert.equal(registro.arquivo, b.nome);
    assert.ok(mesmaPasta(registro.pasta, externa));
    assert.ok(registro.em && !registro.erro);
    assert.ok(fs.existsSync(path.join(pastaBackups(), ARQUIVO_COPIA_EXTERNA)));

    // Falha (o "pen drive" virou um arquivo): erro explicado, e a última cópia boa continua registrada.
    const arquivo = path.join(fora, "nao-e-pasta");
    fs.writeFileSync(arquivo, "x");
    await assert.rejects(copiarParaPastaExterna(b.caminho, path.join(arquivo, "sub")), /não é uma pasta|Não encontrei|Não consegui/);
    const depois = await lerCopiaExterna();
    assert.ok(depois.erro);
    assert.equal(depois.arquivo, b.nome);
    assert.equal(depois.em, registro.em);

    // Pasta dentro dos dados do app não vale como cópia "externa".
    await assert.rejects(copiarParaPastaExterna(b.caminho, path.join(a.dados, "copia")), /dentro dos dados do app/);
  } finally {
    a.fim();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test("Testar pasta: grava e apaga o arquivo de teste (cria a pasta se faltar) e explica quando não dá", async () => {
  const a = await ambiente("testar");
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), "fda-testar-"));
  try {
    const nova = path.join(fora, "Backup Fio de Amor");
    const ok = await testarPastaExterna(nova);
    assert.equal(ok.ok, true, ok.mensagem);
    assert.equal(ok.criada, true);
    assert.match(ok.mensagem, /Tudo certo/);
    assert.match(ok.mensagem, /Espaço livre/);
    assert.deepEqual(fs.readdirSync(nova), []); // o arquivo de teste foi apagado

    fs.writeFileSync(path.join(fora, "arquivo"), "x");
    const ruim = await testarPastaExterna(path.join(fora, "arquivo"));
    assert.equal(ruim.ok, false);
    assert.match(ruim.mensagem, /não é uma pasta/);
    assert.equal((await testarPastaExterna("")).ok, false);
    assert.match((await testarPastaExterna("Backup")).mensagem, /caminho completo/);
    assert.match((await testarPastaExterna(path.join(a.dados, "backups"))).mensagem, /dentro dos dados do app/);
  } finally {
    a.fim();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});

test("mensagens: pasta do perfil do usuário e conta LocalService do Windows", () => {
  const erroDe = (code: string) => Object.assign(new Error(code), { code });
  const perfil = explicarErroDaPasta(erroDe("EPERM"), "C:\\Users\\Maria\\Google Drive\\Backup", {});
  assert.match(perfil, /Sem permissão/);
  assert.ok(perfil.includes(EXPLICACAO_LOCALSERVICE));
  const servico = explicarErroDaPasta(erroDe("EACCES"), "D:\\Backup", { USERPROFILE: "C:\\Windows\\ServiceProfiles\\LocalService" });
  assert.ok(servico.includes("LocalService"));
  const comum = explicarErroDaPasta(erroDe("EACCES"), "D:\\Backup", { USERPROFILE: "C:\\Users\\Maria" });
  assert.ok(!comum.includes("LocalService"));
  assert.match(explicarErroDaPasta(erroDe("ENOENT"), "E:\\Backup", {}), /pen drive.*conectado/);
  assert.match(explicarErroDaPasta(erroDe("ENOSPC"), "E:\\Backup", {}), /espaço/);
  assert.match(explicarErroDaPasta(erroDe("EROFS"), "E:\\Backup", {}), /protegida contra gravação/);
  assert.ok(mesmaPasta("E:\\Backup\\", "e:\\backup"));
  assert.ok(!mesmaPasta("/media/a", "/media/b"));
});

test("backup automático: faz o do dia, copia para a pasta externa uma vez e registra a falha quando o banco some", async () => {
  const a = await ambiente("diario");
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), "fda-diario-"));
  try {
    await a.db.execute({ sql: "INSERT INTO pecas (nome) VALUES (?)", args: ["pulseira"] });
    let consultas = 0;
    const pastaExterna = async () => {
      consultas++;
      return fora;
    };
    await conferirBackupDiario({ pastaExterna });
    const diarios = (await listarBackups()).filter((b) => b.tipo === "diario");
    assert.equal(diarios.length, 1);
    assert.ok(fs.existsSync(path.join(fora, diarios[0].nome)));
    const estado = await lerEstadoDiario();
    assert.equal(estado.arquivo, diarios[0].nome);
    assert.equal(estado.erro, null);
    assert.ok(fs.existsSync(path.join(pastaBackups(), ARQUIVO_ESTADO_DIARIO)));
    const copia = await lerCopiaExterna();
    assert.equal(copia.arquivo, diarios[0].nome);

    // De novo no mesmo dia: não faz outro backup nem outra cópia.
    const antes = fs.statSync(path.join(fora, diarios[0].nome)).mtimeMs;
    await conferirBackupDiario({ pastaExterna });
    assert.equal((await listarBackups()).filter((b) => b.tipo === "diario").length, 1);
    assert.equal(fs.statSync(path.join(fora, diarios[0].nome)).mtimeMs, antes);
    assert.equal(consultas, 2);

    // Novo dia, mas o banco sumiu: não lança erro e registra o motivo.
    for (const b of await listarBackups()) fs.rmSync(path.join(pastaBackups(), b.nome));
    a.db.close();
    fs.rmSync(a.banco, { force: true });
    fs.rmSync(`${a.banco}-wal`, { force: true });
    fs.rmSync(`${a.banco}-shm`, { force: true });
    (globalThis as { __fda_backup?: unknown }).__fda_backup = undefined;
    await conferirBackupDiario({ pastaExterna });
    const falha = await lerEstadoDiario();
    assert.match(falha.erro ?? "", /ainda não existe/);
    assert.equal(falha.arquivo, diarios[0].nome); // o último que deu certo continua registrado
  } finally {
    a.db.close();
    a.fim();
    fs.rmSync(fora, { recursive: true, force: true });
  }
});
