import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createClient } from "@libsql/client";
import { pastaDados, urlArquivo } from "./pastas";

/**
 * Backup do banco local (dados/fiodeamor.db):
 *  - cópia consistente com `VACUUM INTO` em dados/backups/fiodeamor-AAAA-MM-DD-HHmm.db;
 *  - guarda os 14 mais recentes;
 *  - backup automático no máximo 1 vez por dia, em segundo plano (thread separada), sem atrasar as telas.
 * Com Turso (nuvem), quem guarda o histórico é o próprio Turso.
 *
 * Não importe "./db" aqui: o db/index.ts chama backupDiarioSeNecessario() e criaria um ciclo.
 */

export const MANTER_BACKUPS = 14;

export const EXPLICACAO_TURSO =
  "O app está usando o banco na nuvem (Turso), então não há arquivo de backup aqui. O próprio Turso guarda o histórico do banco " +
  "e permite voltar a um momento anterior (restauração para um ponto no tempo; quantos dias ficam guardados depende do plano). " +
  "Para restaurar: no terminal, rode `turso db create fiodeamor-restaurado --from-db NOME-DO-BANCO --timestamp 2026-11-14T09:00:00-03:00` " +
  "(a data e a hora para onde voltar) ou use a opção equivalente no painel app.turso.tech; depois, gere um token do banco novo e troque " +
  "DATABASE_URL e DATABASE_AUTH_TOKEN na Vercel e faça um novo deploy. O passo a passo está em docs/nuvem.md.";

const NOME_VALIDO = /^fiodeamor-(\d{4}-\d{2}-\d{2})-(\d{4})(?:-(\d{1,3}))?\.db$/;

export interface InfoBackup {
  nome: string;
  tamanho: number; // bytes
  data: string; // ISO (hora em que o arquivo foi gravado)
}

/** Caminho do arquivo do banco quando ele é local; null quando é Turso/libSQL remoto. */
export function bancoLocal(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return path.join(pastaDados(), "fiodeamor.db");
  if (!url.startsWith("file:")) return null;
  let caminho = url.slice("file:".length).split("?")[0];
  if (caminho.startsWith("//")) caminho = caminho.slice(2); // file:///caminho/absoluto
  try {
    caminho = decodeURIComponent(caminho);
  } catch {
    /* mantém como veio */
  }
  return path.resolve(process.cwd(), caminho);
}

/** Pasta dos backups: "backups" ao lado do arquivo do banco (padrão: dados/backups). */
export const pastaBackups = () => path.join(path.dirname(bancoLocal() ?? path.join(pastaDados(), "fiodeamor.db")), "backups");

const dois = (n: number) => String(n).padStart(2, "0");
const diaLocal = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

/** Ordem cronológica pelo nome (data, hora e o número de desempate de backups no mesmo minuto). */
function chaveOrdem(nome: string): string {
  const m = NOME_VALIDO.exec(nome);
  return m ? `${m[1]}-${m[2]}-${(m[3] ?? "0").padStart(3, "0")}` : "";
}

/** Backups existentes, do mais novo para o mais antigo. */
export async function listarBackups(): Promise<InfoBackup[]> {
  const pasta = pastaBackups();
  const nomes = (await fs.readdir(pasta).catch(() => [] as string[])).filter((n) => NOME_VALIDO.test(n));
  const lista = await Promise.all(
    nomes.map(async (nome) => {
      const st = await fs.stat(path.join(pasta, nome)).catch(() => null);
      return st?.isFile() ? { nome, tamanho: st.size, data: st.mtime.toISOString() } : null;
    }),
  );
  return lista.filter((b): b is InfoBackup => !!b).sort((a, b) => chaveOrdem(b.nome).localeCompare(chaveOrdem(a.nome)));
}

/** Caminho seguro de um backup pelo nome (barra path traversal: só aceita o padrão fiodeamor-AAAA-MM-DD-HHmm.db). */
export function caminhoDoBackup(nome: string): string | null {
  if (!nome || nome !== path.basename(nome) || !NOME_VALIDO.test(nome)) return null;
  const pasta = pastaBackups();
  const caminho = path.resolve(pasta, nome);
  return path.dirname(caminho) === pasta ? caminho : null;
}

/* ------------------------------------------------- VACUUM INTO fora da thread */

// O cliente libSQL local é síncrono por baixo: um VACUUM INTO na thread principal travaria as outras requisições.
// Por isso o backup roda num worker, que carrega o @libsql/client da pasta do projeto.
const CODIGO_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const path = require("node:path");
(async () => {
  let createClient;
  try {
    ({ createClient } = createRequire(path.join(workerData.raiz, "package.json"))("@libsql/client"));
  } catch (e) {
    parentPort.postMessage({ ok: false, etapa: "carregar", erro: String((e && e.message) || e) });
    return;
  }
  try {
    const c = createClient({ url: "file:" + workerData.origem.split(String.fromCharCode(92)).join("/") });
    try {
      await c.execute("PRAGMA busy_timeout = 15000");
      await c.execute({ sql: "VACUUM INTO ?", args: [workerData.destino] });
    } finally {
      c.close();
    }
    parentPort.postMessage({ ok: true });
  } catch (e) {
    parentPort.postMessage({ ok: false, etapa: "copiar", erro: String((e && e.message) || e) });
  }
})();
`;

class FalhaAoCarregarWorker extends Error {}

function vacuumNoWorker(origem: string, destino: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let terminou = false;
    const fim = (e?: Error) => {
      if (terminou) return;
      terminou = true;
      if (e) reject(e);
      else resolve();
    };
    let worker: Worker;
    try {
      worker = new Worker(CODIGO_WORKER, { eval: true, workerData: { origem, destino, raiz: process.cwd() } });
    } catch (e) {
      fim(new FalhaAoCarregarWorker(e instanceof Error ? e.message : String(e)));
      return;
    }
    worker.once("message", (m: { ok: boolean; etapa?: string; erro?: string }) => {
      if (m?.ok) fim();
      else if (m?.etapa === "carregar") fim(new FalhaAoCarregarWorker(m.erro ?? "falha ao iniciar o backup"));
      else fim(new Error(m?.erro ?? "falha no backup"));
    });
    worker.once("error", (e) => fim(new FalhaAoCarregarWorker(e.message)));
    worker.once("exit", (codigo) => fim(codigo === 0 ? undefined : new Error(`o backup parou (código ${codigo})`)));
  });
}

/** Plano B (sem worker): roda na thread principal; trava o app só durante a cópia. */
async function vacuumDireto(origem: string, destino: string) {
  const c = createClient({ url: urlArquivo(origem) });
  try {
    await c.execute("PRAGMA busy_timeout = 15000");
    await c.execute({ sql: "VACUUM INTO ?", args: [destino] });
  } finally {
    c.close();
  }
}

async function copiarBanco(origem: string, destino: string) {
  try {
    await vacuumNoWorker(origem, destino);
  } catch (e) {
    if (!(e instanceof FalhaAoCarregarWorker)) throw e;
    console.warn("[backup] worker indisponível, copiando na thread principal:", e.message);
    await fs.rm(destino, { force: true });
    await vacuumDireto(origem, destino);
  }
}

/* ------------------------------------------------------------------ backup */

let fila: Promise<unknown> = Promise.resolve();

/** Gera um backup novo (VACUUM INTO) e apaga os antigos além dos 14 mais recentes. */
export function fazerBackup(): Promise<InfoBackup & { caminho: string }> {
  // Um backup por vez (o automático e o do botão não disputam o arquivo).
  const tarefa = fila.then(fazerBackupAgora, fazerBackupAgora);
  fila = tarefa.catch(() => {});
  return tarefa;
}

async function fazerBackupAgora(): Promise<InfoBackup & { caminho: string }> {
  const origem = bancoLocal();
  if (!origem) throw new Error(EXPLICACAO_TURSO);
  await fs.access(origem).catch(() => {
    throw new Error(`O banco local ainda não existe (${path.relative(process.cwd(), origem) || origem}).`);
  });
  const pasta = pastaBackups();
  await fs.mkdir(pasta, { recursive: true });

  const d = new Date();
  const baseNome = `fiodeamor-${diaLocal(d)}-${dois(d.getHours())}${dois(d.getMinutes())}`;
  const temporario = path.join(pasta, `.${baseNome}-${process.pid}-${Date.now()}.tmp`);
  try {
    await copiarBanco(origem, temporario);
    let nome = `${baseNome}.db`;
    for (let n = 2; await existe(path.join(pasta, nome)); n++) nome = `${baseNome}-${n}.db`;
    const caminho = path.join(pasta, nome);
    await fs.rename(temporario, caminho);
    await limparAntigos();
    const st = await fs.stat(caminho);
    return { nome, caminho, tamanho: st.size, data: st.mtime.toISOString() };
  } finally {
    await fs.rm(temporario, { force: true }).catch(() => {});
  }
}

const existe = (caminho: string) =>
  fs.access(caminho).then(
    () => true,
    () => false,
  );

async function limparAntigos() {
  const lista = await listarBackups();
  for (const b of lista.slice(MANTER_BACKUPS)) {
    await fs.rm(path.join(pastaBackups(), b.nome), { force: true }).catch((e) => console.error("[backup] não apagou", b.nome, e));
  }
}

/* -------------------------------------------------------- backup automático */

type Estado = { dia?: string; rodando?: boolean; falhouEm?: number };
const g = globalThis as unknown as { __fda_backup?: Estado };
const estado = () => (g.__fda_backup ??= {});

/**
 * Backup automático: no máximo 1 por dia, em segundo plano e sem nunca lançar erro.
 * Pode ser chamado a cada acesso ao banco: quando o backup do dia já existe, volta na hora.
 */
export function backupDiarioSeNecessario(): Promise<void> {
  try {
    if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
    if (!bancoLocal()) return Promise.resolve();
    const st = estado();
    const hoje = diaLocal(new Date());
    if (st.dia === hoje || st.rodando) return Promise.resolve();
    if (st.falhouEm && Date.now() - st.falhouEm < 60 * 60 * 1000) return Promise.resolve(); // tenta de novo em 1 hora
    st.rodando = true;
    return new Promise<void>((resolve) => {
      // Espera alguns segundos para não disputar com a requisição que acabou de abrir o banco.
      const t = setTimeout(() => {
        rodarDiario(hoje).finally(resolve);
      }, 5000);
      (t as { unref?: () => void }).unref?.(); // não segura o processo aberto (ex.: scripts)
    });
  } catch (e) {
    console.error("[backup] backup automático não iniciou:", e);
    return Promise.resolve();
  }
}

async function rodarDiario(hoje: string) {
  const st = estado();
  try {
    const jaTem = (await listarBackups()).some((b) => b.nome.startsWith(`fiodeamor-${hoje}-`));
    if (!jaTem) {
      const b = await fazerBackup();
      console.info(`[backup] backup automático criado: ${b.nome}`);
    }
    st.dia = hoje;
    st.falhouEm = undefined;
  } catch (e) {
    st.falhouEm = Date.now();
    console.error("[backup] backup automático falhou:", e instanceof Error ? e.message : e);
  } finally {
    st.rodando = false;
  }
}
