import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { createClient } from "@libsql/client";
import { caminhoWindows, normalizarPasta, pastaDados, pastaDoPerfilDoUsuario, problemaDaPastaExterna, rodandoComoLocalService, urlArquivo } from "./pastas";

/**
 * Backup do banco local (dados/fiodeamor.db), na pasta dados/backups:
 *  - cópia consistente com `VACUUM INTO` (lê também o que ainda está no arquivo -wal; uma cópia simples do arquivo .db perderia isso);
 *  - três tipos, cada um com a sua rotação: diário automático (14), manual pelo botão (20) e antes de atualizar o banco (3);
 *  - o diário roda no máximo 1 vez por dia, em segundo plano (thread separada), sem atrasar as telas, e depois é copiado
 *    para a pasta externa (pen drive ou pasta sincronizada pela nuvem) de Configurações → sistema.backupPastaExterna;
 *  - antes de copiar, confere o espaço livre (precisa de 2× o tamanho do banco + 50 MB).
 * Com Turso (nuvem), quem guarda o histórico é o próprio Turso.
 *
 * Sem "server-only" para os testes (tests/infra-backup.test.ts) importarem, mas só roda no servidor (node:fs, worker_threads).
 * Não importe "./db" (nem config/historico, que importam o banco): o db/index.ts chama este módulo e criaria um ciclo.
 */

export type TipoBackup = "diario" | "manual" | "antes-da-migracao";

export const MANTER_BACKUPS = 14; // diários (automáticos)
export const MANTER_MANUAIS = 20;
export const MANTER_ANTES_MIGRACAO = 3;
export const MANTER_COPIAS_EXTERNAS = 14;
export const MANTER: Record<TipoBackup, number> = { diario: MANTER_BACKUPS, manual: MANTER_MANUAIS, "antes-da-migracao": MANTER_ANTES_MIGRACAO };

/** Folga exigida além de 2× o tamanho do banco (o VACUUM INTO grava uma cópia inteira antes de renomear). */
export const MARGEM_ESPACO = 50 * 1024 * 1024;

export const EXPLICACAO_TURSO =
  "O app está usando o banco na nuvem (Turso), então não há arquivo de backup aqui. O próprio Turso guarda o histórico do banco " +
  "e permite voltar a um momento anterior (restauração para um ponto no tempo; quantos dias ficam guardados depende do plano). " +
  "Para restaurar: no terminal, rode `turso db create fiodeamor-restaurado --from-db NOME-DO-BANCO --timestamp 2026-11-14T09:00:00-03:00` " +
  "(a data e a hora para onde voltar) ou use a opção equivalente no painel app.turso.tech; depois, gere um token do banco novo e troque " +
  "DATABASE_URL e DATABASE_AUTH_TOKEN na Vercel e faça um novo deploy. O passo a passo está em docs/nuvem.md.";

export const EXPLICACAO_LOCALSERVICE =
  "No computador da loja, o servidor do app roda como a conta de serviço do Windows LocalService, que não grava nas pastas dos usuários " +
  "(como C:\\Users\\Maria\\Google Drive ou C:\\Users\\Maria\\OneDrive) nem enxerga a unidade G: do Google Drive. Use um pen drive " +
  "ou uma pasta fora do perfil, como C:\\FioDeAmor-Backup (criada pelo instalador) ou D:\\Backup Fio de Amor, e peça ao Google Drive " +
  "para sincronizar essa pasta (Google Drive → Preferências → Meu computador → Adicionar pasta).";

/* ------------------------------------------------------------- nomes */

// diário:              fiodeamor-2026-11-15-0930.db  (o "-2" desempata dois backups no mesmo minuto)
// manual:              fiodeamor-manual-2026-11-15-0930.db
// antes da migração:   antes-da-migracao-0007-2026-11-15-0930.db
const PADRAO_NOME: Record<TipoBackup, RegExp> = {
  diario: /^fiodeamor-(\d{4}-\d{2}-\d{2})-(\d{4})(?:-(\d{1,3}))?\.db$/,
  manual: /^fiodeamor-manual-(\d{4}-\d{2}-\d{2})-(\d{4})(?:-(\d{1,3}))?\.db$/,
  "antes-da-migracao": /^antes-da-migracao-[0-9a-z]{1,20}-(\d{4}-\d{2}-\d{2})-(\d{4})(?:-(\d{1,3}))?\.db$/,
};
const TIPOS = Object.keys(PADRAO_NOME) as TipoBackup[];

export interface InfoBackup {
  nome: string;
  tamanho: number; // bytes
  data: string; // ISO (hora em que o arquivo foi gravado)
  tipo?: TipoBackup;
}

/** Tipo do backup pelo nome do arquivo; null quando não é um arquivo de backup do app. */
export function tipoDoBackup(nome: string): TipoBackup | null {
  return TIPOS.find((t) => PADRAO_NOME[t].test(nome)) ?? null;
}

/** Chave de ordem cronológica pelo nome (data, hora e o número de desempate), para qualquer tipo. */
function chaveOrdem(nome: string): string {
  for (const t of TIPOS) {
    const m = PADRAO_NOME[t].exec(nome);
    if (m) return `${m[1]}-${m[2]}-${(m[3] ?? "0").padStart(3, "0")}`;
  }
  return "";
}

const dois = (n: number) => String(n).padStart(2, "0");
const diaLocal = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

/** Número da migração para o nome do arquivo ("0007_nova_coluna" → "0007"). */
export function numeroDaMigracao(tag: string): string {
  return /^(\d{1,6})/.exec(tag)?.[1] ?? (tag.toLowerCase().replace(/[^0-9a-z]+/g, "").slice(0, 20) || "x");
}

/** Nome do arquivo de backup (sem o desempate "-2", "-3"… que é acrescentado se já existir um no mesmo minuto). */
export function nomeDoBackup(tipo: TipoBackup, quando: Date, numeroMigracao = ""): string {
  const momento = `${diaLocal(quando)}-${dois(quando.getHours())}${dois(quando.getMinutes())}`;
  if (tipo === "manual") return `fiodeamor-manual-${momento}.db`;
  if (tipo === "antes-da-migracao") return `antes-da-migracao-${numeroDaMigracao(numeroMigracao)}-${momento}.db`;
  return `fiodeamor-${momento}.db`;
}

/** Ordena do mais novo para o mais antigo (pelo nome; empate pela data do arquivo). */
export function ordenarBackups<T extends { nome: string; data?: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => chaveOrdem(b.nome).localeCompare(chaveOrdem(a.nome)) || (b.data ?? "").localeCompare(a.data ?? ""));
}

/** Rotação: nomes do `tipo` que passam dos `manter` mais recentes (os outros tipos nunca entram). */
export function escolherParaApagar(nomes: string[], tipo: TipoBackup, manter: number): string[] {
  const doTipo = ordenarBackups(nomes.filter((n) => tipoDoBackup(n) === tipo).map((nome) => ({ nome })));
  return doTipo.slice(Math.max(0, manter)).map((b) => b.nome);
}

/* ------------------------------------------------------------- caminhos */

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

/** Backups existentes (todos os tipos), do mais novo para o mais antigo. */
export async function listarBackups(): Promise<InfoBackup[]> {
  const pasta = pastaBackups();
  const nomes = (await fs.readdir(pasta).catch(() => [] as string[])).filter((n) => tipoDoBackup(n));
  const lista = await Promise.all(
    nomes.map(async (nome) => {
      const st = await fs.stat(path.join(pasta, nome)).catch(() => null);
      return st?.isFile() ? { nome, tamanho: st.size, data: st.mtime.toISOString(), tipo: tipoDoBackup(nome) ?? undefined } : null;
    }),
  );
  return ordenarBackups(lista.filter((b): b is NonNullable<typeof b> => !!b));
}

/** Caminho seguro de um backup pelo nome (barra path traversal: só aceita os nomes de backup do app). */
export function caminhoDoBackup(nome: string): string | null {
  if (!nome || nome !== path.basename(nome) || !tipoDoBackup(nome)) return null;
  const pasta = pastaBackups();
  const caminho = path.resolve(pasta, nome);
  return path.dirname(caminho) === pasta ? caminho : null;
}

const existe = (caminho: string) =>
  fs.access(caminho).then(
    () => true,
    () => false,
  );

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} MB`;
const gb = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB` : mb(bytes);

/* -------------------------------------------------------- espaço livre */

export type StatFs = (pasta: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

export class EspacoInsuficiente extends Error {}

/** Espaço que o backup precisa no disco: 2× o banco + 50 MB. */
export const espacoMinimoParaBackup = (tamanhoBanco: number) => 2 * tamanhoBanco + MARGEM_ESPACO;

/** Tamanho do banco somando o arquivo -wal (o que ainda não foi passado para o .db também vai para a cópia). */
export async function tamanhoDoBanco(origem: string): Promise<number> {
  const [db, wal] = await Promise.all([fs.stat(origem).catch(() => null), fs.stat(`${origem}-wal`).catch(() => null)]);
  return (db?.size ?? 0) + (wal?.size ?? 0);
}

/** Bytes livres no disco da pasta (null quando o sistema não informa). */
export async function espacoLivre(pasta: string, statfs: StatFs = fs.statfs): Promise<number | null> {
  try {
    const st = await statfs(pasta);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

/** Lança EspacoInsuficiente quando o disco da pasta não tem 2× o banco + 50 MB livres. */
export async function conferirEspacoLivre(origem: string, pasta: string, statfs: StatFs = fs.statfs): Promise<void> {
  const livre = await espacoLivre(pasta, statfs);
  if (livre == null) return; // sem como saber: tenta mesmo assim
  const tamanho = await tamanhoDoBanco(origem);
  const minimo = espacoMinimoParaBackup(tamanho);
  if (livre < minimo) {
    throw new EspacoInsuficiente(
      `Backup não feito: falta espaço no disco. Há ${gb(livre)} livres e o backup precisa de ${gb(minimo)} ` +
        `(2 vezes o banco, que tem ${gb(tamanho)}, mais 50 MB). Libere espaço no disco (apague arquivos que não usa ou backups manuais antigos).`,
    );
  }
}

/* ------------------------------------------------- VACUUM INTO fora da thread */

// O cliente libSQL local é síncrono por baixo: um VACUUM INTO na thread principal travaria as outras requisições.
// Por isso o backup roda num worker, que carrega o @libsql/client da pasta do projeto.
// Com o banco em WAL (db/index.ts), essa leitura longa não trava as gravações do app.
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

export interface OpcoesBackup {
  numeroMigracao?: string; // tipo "antes-da-migracao": tag ou número da primeira migração pendente
  statfs?: StatFs; // testes
  agora?: Date; // testes
}

let fila: Promise<unknown> = Promise.resolve();

/**
 * Gera um backup novo (VACUUM INTO) e apaga os antigos do mesmo tipo além dos que ficam guardados
 * (14 diários, 20 manuais, 3 antes da migração). Um backup por vez: o automático e o do botão não disputam o arquivo.
 */
export function fazerBackup(tipo: TipoBackup = "manual", opcoes: OpcoesBackup = {}): Promise<InfoBackup & { caminho: string }> {
  const rodar = () => fazerBackupAgora(tipo, opcoes);
  const tarefa = fila.then(rodar, rodar);
  fila = tarefa.catch(() => {});
  return tarefa;
}

async function fazerBackupAgora(tipo: TipoBackup, opcoes: OpcoesBackup): Promise<InfoBackup & { caminho: string }> {
  const origem = bancoLocal();
  if (!origem) throw new Error(EXPLICACAO_TURSO);
  await fs.access(origem).catch(() => {
    throw new Error(`O banco local ainda não existe (${path.relative(process.cwd(), origem) || origem}).`);
  });
  const pasta = pastaBackups();
  await fs.mkdir(pasta, { recursive: true });
  await conferirEspacoLivre(origem, pasta, opcoes.statfs);

  const d = opcoes.agora ?? new Date();
  const base = nomeDoBackup(tipo, d, opcoes.numeroMigracao).replace(/\.db$/, "");
  const temporario = path.join(pasta, `.${base}-${process.pid}-${Date.now()}.tmp`);
  try {
    await copiarBanco(origem, temporario);
    let nome = `${base}.db`;
    for (let n = 2; await existe(path.join(pasta, nome)); n++) nome = `${base}-${n}.db`;
    const caminho = path.join(pasta, nome);
    await fs.rename(temporario, caminho);
    await limparAntigos(tipo);
    const st = await fs.stat(caminho);
    return { nome, caminho, tamanho: st.size, data: st.mtime.toISOString(), tipo };
  } finally {
    await fs.rm(temporario, { force: true }).catch(() => {});
  }
}

async function limparAntigos(tipo: TipoBackup) {
  const pasta = pastaBackups();
  const nomes = await fs.readdir(pasta).catch(() => [] as string[]);
  for (const nome of escolherParaApagar(nomes, tipo, MANTER[tipo])) {
    await fs.rm(path.join(pasta, nome), { force: true }).catch((e) => console.error("[backup] não apagou", nome, e));
  }
}

/* -------------------------------------------------- backup antes da migração */

/** Banco local que já tem dados (alguma migração aplicada) e vai receber migração nova: copia antes. */
export const deveFazerBackupAntesDaMigracao = (s: { local: boolean; aplicadas: number; pendentes: number }) => s.local && s.aplicadas > 0 && s.pendentes > 0;

/** Cópia "antes-da-migracao-<nº>-<data>.db" (chamada pelo db/index.ts antes de aplicar migrações). */
export function backupAntesDaMigracao(tag: string, opcoes: OpcoesBackup = {}) {
  return fazerBackup("antes-da-migracao", { ...opcoes, numeroMigracao: tag });
}

/* ------------------------------------------------ cópia para a pasta externa */

/** Registro da última cópia para a pasta externa (gravado em backups/.copia-externa.json). */
export interface CopiaExterna {
  em: string | null; // ISO da última cópia bem-sucedida
  pasta: string | null; // pasta da última tentativa
  arquivo: string | null; // arquivo da última cópia bem-sucedida
  erro: string | null; // última falha (vazio quando a última tentativa deu certo)
  tentativaEm: string | null;
}

export const ARQUIVO_COPIA_EXTERNA = ".copia-externa.json";

export async function lerCopiaExterna(): Promise<CopiaExterna> {
  const vazio: CopiaExterna = { em: null, pasta: null, arquivo: null, erro: null, tentativaEm: null };
  if (!bancoLocal()) return vazio;
  try {
    return { ...vazio, ...JSON.parse(await fs.readFile(path.join(pastaBackups(), ARQUIVO_COPIA_EXTERNA), "utf8")) };
  } catch {
    return vazio;
  }
}

async function gravarJson(arquivo: string, dados: unknown) {
  try {
    await fs.mkdir(pastaBackups(), { recursive: true });
    const destino = path.join(pastaBackups(), arquivo);
    const temp = `${destino}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(dados, null, 2));
    await fs.rename(temp, destino);
  } catch (e) {
    console.error(`[backup] não gravou ${arquivo}:`, mensagem(e));
  }
}

/** Mesma pasta? (no Windows, sem diferença entre maiúsculas e minúsculas) */
export function mesmaPasta(a: string | null | undefined, b: string | null | undefined): boolean {
  a = normalizarPasta(a);
  b = normalizarPasta(b);
  if (!a || !b) return false;
  const windows = caminhoWindows(a) || caminhoWindows(b);
  const mod = windows ? path.win32 : path.posix;
  const norm = (s: string) => mod.resolve(s).replace(/[\\/]+$/, "");
  return windows ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** Explicação clara de uma falha ao gravar na pasta externa (inclusive o caso da conta LocalService do Windows). */
export function explicarErroDaPasta(e: unknown, pasta: string, env: Record<string, string | undefined> = process.env): string {
  if (e instanceof EspacoInsuficiente) return e.message;
  const codigo = (e as NodeJS.ErrnoException | null)?.code;
  const perfil = pastaDoPerfilDoUsuario(pasta);
  const servico = rodandoComoLocalService(env);
  let texto: string;
  switch (codigo) {
    case "EACCES":
    case "EPERM":
      texto = `Sem permissão para gravar em ${pasta}.`;
      if (!perfil && !servico) texto += " Escolha outra pasta ou peça a quem cuida do computador para liberar a gravação.";
      break;
    case "ENOENT":
      texto =
        `Não encontrei ${pasta}. Se for pen drive, confira se ele está conectado e qual é a letra da unidade (ex.: E:). ` +
        "Unidades de rede (Z:) e a unidade G: do Google Drive não aparecem para o servidor.";
      break;
    case "ENOSPC":
      texto = `Sem espaço livre em ${pasta}. Apague cópias antigas que não precisa ou use um pen drive maior.`;
      break;
    case "EROFS":
      texto = `${pasta} está protegida contra gravação (o pen drive tem trava?).`;
      break;
    case "ENOTDIR":
    case "EEXIST":
      texto = `${pasta} não é uma pasta (parece ser um arquivo). Confira o caminho.`;
      break;
    case "EBUSY":
      texto = `${pasta} está ocupada por outro programa. Tente de novo daqui a pouco.`;
      break;
    default:
      texto = `Não consegui gravar em ${pasta}: ${mensagem(e)}`;
  }
  return perfil || ((codigo === "EACCES" || codigo === "EPERM") && servico) ? `${texto} ${EXPLICACAO_LOCALSERVICE}` : texto;
}

class ErroPasta extends Error {}

/** Valida e prepara a pasta externa (cria se não existir). */
async function prepararPastaExterna(pasta: string): Promise<{ pasta: string; criada: boolean }> {
  const problema = problemaDaPastaExterna(pasta);
  if (problema) throw new ErroPasta(problema);
  const p = normalizarPasta(pasta);
  const st = await fs.stat(p).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? null : Promise.reject(e)));
  if (st && !st.isDirectory()) throw Object.assign(new Error("não é uma pasta"), { code: "ENOTDIR" });
  if (!st) await fs.mkdir(p, { recursive: true });
  return { pasta: p, criada: !st };
}

/**
 * Copia um backup diário para a pasta externa, mantém lá só as `manter` cópias mais recentes (apaga apenas arquivos
 * com o nome dos backups diários do app, nunca outros arquivos da pasta) e grava backups/.copia-externa.json
 * no sucesso e na falha. Lança o erro (já explicado) quando não consegue.
 */
export async function copiarParaPastaExterna(arquivo: string, pastaExterna: string, opcoes: { manter?: number } = {}): Promise<CopiaExterna> {
  const manter = Math.max(1, opcoes.manter ?? MANTER_COPIAS_EXTERNAS);
  const anterior = await lerCopiaExterna();
  const tentativaEm = new Date().toISOString();
  const nome = path.basename(arquivo);
  let temporario: string | null = null;
  try {
    const { pasta } = await prepararPastaExterna(pastaExterna);
    const apagar = async (quantos: number) => {
      const nomes = (await fs.readdir(pasta)).filter((n) => n !== nome);
      for (const velho of escolherParaApagar(nomes, "diario", quantos)) await fs.rm(path.join(pasta, velho), { force: true });
    };
    // Abre espaço antes (fica com manter − 1 cópias antigas + a nova), para caber num pen drive quase cheio.
    await apagar(manter - 1);
    const tamanho = (await fs.stat(arquivo)).size;
    const livre = await espacoLivre(pasta);
    if (livre != null && livre < tamanho + 10 * 1024 * 1024) {
      throw new EspacoInsuficiente(`Sem espaço livre em ${pasta}: há ${gb(livre)} e a cópia tem ${gb(tamanho)}. Apague arquivos que não precisa ou use um pen drive maior.`);
    }
    // Copia com nome provisório e renomeia no fim: uma cópia pela metade (pen drive tirado no meio) nunca fica com nome de backup.
    temporario = path.join(pasta, `.${nome}.${process.pid}.parcial`);
    await fs.copyFile(arquivo, temporario);
    await fs.rename(temporario, path.join(pasta, nome));
    temporario = null;
    await apagar(manter - 1);
    const registro: CopiaExterna = { em: tentativaEm, pasta, arquivo: nome, erro: null, tentativaEm };
    await gravarJson(ARQUIVO_COPIA_EXTERNA, registro);
    return registro;
  } catch (e) {
    const texto = e instanceof ErroPasta ? e.message : explicarErroDaPasta(e, normalizarPasta(pastaExterna));
    await gravarJson(ARQUIVO_COPIA_EXTERNA, { ...anterior, pasta: normalizarPasta(pastaExterna) || null, erro: texto, tentativaEm } satisfies CopiaExterna);
    throw new Error(texto);
  } finally {
    if (temporario) await fs.rm(temporario, { force: true }).catch(() => {});
  }
}

/**
 * Botão "Testar pasta": grava, lê e apaga um arquivo de teste na pasta (criando a pasta se ainda não existir)
 * e informa o espaço livre. Não muda a configuração.
 */
export async function testarPastaExterna(pastaExterna: string): Promise<{ ok: boolean; mensagem: string; pasta: string; criada?: boolean; livre?: number | null }> {
  const p = normalizarPasta(pastaExterna);
  let teste: string | null = null;
  try {
    const { pasta, criada } = await prepararPastaExterna(p);
    teste = path.join(pasta, `.fiodeamor-teste-${process.pid}-${Date.now()}.tmp`);
    const conteudo = `Teste do backup do Fio de Amor - ${new Date().toISOString()}`;
    await fs.writeFile(teste, conteudo);
    const lido = await fs.readFile(teste, "utf8");
    await fs.rm(teste);
    teste = null;
    if (lido !== conteudo) throw new Error("o arquivo de teste voltou diferente do que foi gravado");
    const livre = await espacoLivre(pasta);
    const origem = bancoLocal();
    const tamanho = origem ? await tamanhoDoBanco(origem) : 0;
    let espaco = "";
    if (livre != null) {
      espaco = ` Espaço livre: ${gb(livre)}`;
      if (tamanho > 0) {
        const cabem = Math.floor(livre / tamanho);
        espaco += `; cada cópia tem cerca de ${gb(tamanho)}, então cabem ${cabem} cópia(s) (o app guarda as ${MANTER_COPIAS_EXTERNAS} mais recentes).`;
        if (cabem < MANTER_COPIAS_EXTERNAS) espaco += " Quando encher, a cópia do dia falha e o aviso aparece aqui.";
      } else espaco += ".";
    }
    return {
      ok: true,
      pasta,
      criada,
      livre,
      mensagem: `Tudo certo: o app gravou e apagou um arquivo de teste em ${pasta}.${criada ? " A pasta não existia e foi criada agora." : ""}${espaco} Clique em Salvar para usar esta pasta.`,
    };
  } catch (e) {
    return { ok: false, pasta: p, mensagem: e instanceof ErroPasta ? e.message : explicarErroDaPasta(e, p) };
  } finally {
    if (teste) await fs.rm(teste, { force: true }).catch(() => {});
  }
}

/* -------------------------------------------------------- backup automático */

/** Situação do backup automático (backups/.backup-diario.json): o último que deu certo e a última falha. */
export interface EstadoDiario {
  em: string | null;
  arquivo: string | null;
  erro: string | null; // vazio quando a última tentativa deu certo
  tentativaEm: string | null;
}

export const ARQUIVO_ESTADO_DIARIO = ".backup-diario.json";

export async function lerEstadoDiario(): Promise<EstadoDiario> {
  const vazio: EstadoDiario = { em: null, arquivo: null, erro: null, tentativaEm: null };
  if (!bancoLocal()) return vazio;
  try {
    return { ...vazio, ...JSON.parse(await fs.readFile(path.join(pastaBackups(), ARQUIVO_ESTADO_DIARIO), "utf8")) };
  } catch {
    return vazio;
  }
}

export interface OpcoesDiario {
  /** Pasta externa configurada (lida do banco pelo db/index.ts, que pode importar o banco sem ciclo). */
  pastaExterna?: () => Promise<string | null | undefined>;
}

type Estado = { rodando?: boolean; proxima?: number; pastaExterna?: OpcoesDiario["pastaExterna"]; copiaConfirmada?: string };
const g = globalThis as unknown as { __fda_backup?: Estado };
const estado = () => (g.__fda_backup ??= {});

const CONFERIR_A_CADA = 10 * 60 * 1000; // confere o backup do dia e a cópia externa a cada 10 minutos de uso
const TENTAR_DE_NOVO_EM = 60 * 60 * 1000; // depois de uma falha, tenta de novo em 1 hora

/**
 * Backup automático: no máximo 1 por dia, em segundo plano e sem nunca lançar erro; depois copia para a pasta externa.
 * Pode ser chamado a cada acesso ao banco: entre uma conferência e outra, volta na hora.
 */
export function backupDiarioSeNecessario(opcoes: OpcoesDiario = {}): Promise<void> {
  try {
    if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
    if (!bancoLocal()) return Promise.resolve();
    const st = estado();
    if (opcoes.pastaExterna) st.pastaExterna = opcoes.pastaExterna;
    if (st.rodando || (st.proxima && Date.now() < st.proxima)) return Promise.resolve();
    st.rodando = true;
    return new Promise<void>((resolve) => {
      // Espera alguns segundos para não disputar com a requisição que acabou de abrir o banco.
      const t = setTimeout(() => {
        rodarDiario().finally(resolve);
      }, 5000);
      (t as { unref?: () => void }).unref?.(); // não segura o processo aberto (ex.: scripts)
    });
  } catch (e) {
    console.error("[backup] backup automático não iniciou:", e);
    return Promise.resolve();
  }
}

/** Confere agora (sem a espera de 5 s): faz o backup do dia se faltar e a cópia externa se faltar. Nunca lança erro. */
export async function conferirBackupDiario(opcoes: OpcoesDiario = {}): Promise<void> {
  const st = estado();
  if (opcoes.pastaExterna) st.pastaExterna = opcoes.pastaExterna;
  if (st.rodando || !bancoLocal()) return;
  st.rodando = true;
  await rodarDiario();
}

async function rodarDiario() {
  const st = estado();
  let proxima = Date.now() + CONFERIR_A_CADA;
  try {
    const agora = new Date();
    const hoje = diaLocal(agora);
    let backup: InfoBackup | undefined = (await listarBackups()).find((b) => b.tipo === "diario" && b.nome.startsWith(`fiodeamor-${hoje}-`));
    if (!backup) {
      try {
        backup = await fazerBackup("diario");
        await gravarJson(ARQUIVO_ESTADO_DIARIO, { em: backup.data, arquivo: backup.nome, erro: null, tentativaEm: agora.toISOString() } satisfies EstadoDiario);
        console.info(`[backup] backup automático criado: ${backup.nome}`);
      } catch (e) {
        await gravarJson(ARQUIVO_ESTADO_DIARIO, { ...(await lerEstadoDiario()), erro: mensagem(e), tentativaEm: agora.toISOString() } satisfies EstadoDiario);
        throw e;
      }
    }

    const pasta = normalizarPasta(await st.pastaExterna?.().catch(() => null));
    if (pasta) {
      const chave = `${pasta}|${backup.nome}`;
      if (st.copiaConfirmada !== chave) {
        const ultima = await lerCopiaExterna();
        const jaCopiado = !ultima.erro && ultima.arquivo === backup.nome && mesmaPasta(ultima.pasta, pasta) && (await existe(path.join(pasta, backup.nome)));
        if (!jaCopiado) {
          await copiarParaPastaExterna(path.join(pastaBackups(), backup.nome), pasta);
          console.info(`[backup] cópia do backup ${backup.nome} gravada em ${pasta}`);
        }
        st.copiaConfirmada = chave;
      }
    }
  } catch (e) {
    proxima = Date.now() + TENTAR_DE_NOVO_EM;
    console.error("[backup] backup automático ou cópia externa falhou:", mensagem(e));
  } finally {
    st.proxima = proxima;
    st.rodando = false;
  }
}

/* ------------------------------------------------------ estado (painel) */

/** Resumo para o Painel: último backup e última cópia fora do computador. */
export async function estadoBackup(): Promise<{ local: boolean; ultimoBackup: InfoBackup | null; copiaExterna: CopiaExterna }> {
  const local = !!bancoLocal();
  if (!local) return { local, ultimoBackup: null, copiaExterna: await lerCopiaExterna() };
  const [ultimoBackup] = await listarBackups();
  return { local, ultimoBackup: ultimoBackup ?? null, copiaExterna: await lerCopiaExterna() };
}
