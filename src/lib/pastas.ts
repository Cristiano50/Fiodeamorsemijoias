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
