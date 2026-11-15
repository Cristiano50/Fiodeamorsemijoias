import path from "node:path";

/**
 * Pasta dos dados locais (banco, backups, segredo da sessão).
 * Padrão: ./dados ao lado do app. O instalador do Windows define FDA_DADOS (ex.: C:\\FioDeAmor\\dados)
 * para os dados ficarem fora da pasta do programa e sobreviverem às atualizações.
 */
export function pastaDados(): string {
  const env = process.env.FDA_DADOS?.trim();
  return env ? path.resolve(env) : path.resolve(process.cwd(), "dados");
}

/** URL "file:" para o libSQL com barras normais (no Windows: file:C:/FioDeAmor/dados/fiodeamor.db). */
export const urlArquivo = (caminho: string) => `file:${caminho.replace(/\\/g, "/")}`;

/* ------------------------------------------------ pasta externa do backup */

/** Pasta digitada ou colada: sem espaços nas pontas e sem as aspas do "Copiar como caminho" do Windows. */
export const normalizarPasta = (p: string | null | undefined) =>
  String(p ?? "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();

/** Caminho no formato do Windows: com letra de unidade (C:\...) ou de rede (\\servidor\pasta). */
export const caminhoWindows = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || /^\\\\[^\\]/.test(p);

/**
 * Pasta dentro do perfil de um usuário do Windows (C:\Users\Maria\..., inclusive Google Drive e OneDrive de lá).
 * No computador da loja, o servidor roda como a conta de serviço LocalService, que não grava nessas pastas.
 */
export function pastaDoPerfilDoUsuario(p: string): boolean {
  const m = /^[a-zA-Z]:[\\/]+(?:users|usu[aá]rios)[\\/]+([^\\/]+)/i.exec(p.trim());
  return !!m && !/^(public|p[uú]blico|default|default user|all users)$/i.test(m[1]);
}

/** O servidor está rodando como a conta de serviço LocalService do Windows (tarefa criada pelo instalador)? */
export function rodandoComoLocalService(env: Record<string, string | undefined> = process.env): boolean {
  return /[\\/]ServiceProfiles[\\/]LocalService[\\/]?$/i.test(env.USERPROFILE ?? "");
}

const mesmaOuDentro = (alvo: string, base: string, windows: boolean) => {
  const mod = windows ? path.win32 : path.posix;
  const a = mod.resolve(alvo);
  const b = mod.resolve(base);
  const norm = (s: string) => (windows ? s.toLowerCase() : s);
  const sep = windows ? "\\" : "/";
  return norm(a) === norm(b) || norm(a).startsWith(norm(b.endsWith(sep) ? b : b + sep));
};

/**
 * Confere a pasta externa do backup (pen drive, pasta sincronizada pela nuvem) antes de gravar nela.
 * Devolve a explicação do problema, ou null quando a pasta pode ser usada.
 *  - `dados`: pasta dos dados do app (a cópia "externa" não pode ficar dentro dela);
 *  - `programa`: pasta do programa em execução (no Windows, C:\FioDeAmor\app, trocada a cada atualização); padrão: a pasta atual.
 */
export function problemaDaPastaExterna(pasta: string, opcoes: { dados?: string; programa?: string | null } = {}): string | null {
  const p = normalizarPasta(pasta);
  if (!p) return "Informe a pasta. Exemplos: E:\\Backup Fio de Amor (pen drive) ou C:\\FioDeAmor-Backup.";
  const windows = caminhoWindows(p);
  if (!windows && (process.platform === "win32" || !p.startsWith("/"))) {
    return "Use o caminho completo da pasta, com a letra da unidade. Exemplos: E:\\Backup Fio de Amor (pen drive) ou C:\\FioDeAmor-Backup.";
  }
  const dados = opcoes.dados ?? pastaDados();
  if (mesmaOuDentro(p, dados, windows)) {
    return `Essa pasta fica dentro dos dados do app (${dados}), no mesmo disco: não protege se o computador estragar. Escolha um pen drive ou outra pasta, como C:\\FioDeAmor-Backup.`;
  }
  const programa = opcoes.programa === undefined ? process.cwd() : opcoes.programa;
  if (programa && mesmaOuDentro(p, programa, windows)) {
    return `Essa pasta fica dentro da pasta do programa (${programa}), que é trocada a cada atualização. Escolha um pen drive ou outra pasta, como C:\\FioDeAmor-Backup.`;
  }
  return null;
}
