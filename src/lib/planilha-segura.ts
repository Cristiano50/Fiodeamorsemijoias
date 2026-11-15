// Sem "server-only" para poder ser testado (tests/planilha-segura.test.ts); usa node:zlib, então só roda no servidor.
import { inflateRawSync } from "node:zlib";

/**
 * Defesa antes de abrir uma planilha .xlsx com o exceljs (item 15 da revisão).
 * Um .xlsx é um ZIP: um arquivo pequeno pode "explodir" em gigabytes ao descompactar (zip-bomb)
 * e derrubar o servidor da loja. Aqui lemos o diretório do ZIP e descompactamos cada parte com
 * teto de bytes (maxOutputLength do zlib), sem confiar nos tamanhos declarados no arquivo.
 *
 * Uso (vendas, consignado, códigos do UP):
 *   const dados = Buffer.from(await arquivo.arrayBuffer());
 *   verificarXlsx(dados);                  // lança PlanilhaInvalida com mensagem para a tela
 *   await wb.xlsx.load(dados);
 *   verificarLinhas(ws.rowCount);          // depois de abrir: limite de linhas
 */

export class PlanilhaInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "PlanilhaInvalida";
  }
}

export const LIMITES_PLANILHA = {
  maxBytes: 15 * 1024 * 1024, // arquivo enviado
  maxDescompactado: 200 * 1024 * 1024, // soma das partes descompactadas
  maxPartes: 5000, // arquivos dentro do ZIP
  maxLinhas: 50_000, // linhas por aba
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace(".", ",")} MB`;

/** Planilhas antigas (.xls) e CSV não são ZIP: só o limite de tamanho vale para elas. */
export function ehZip(dados: Uint8Array): boolean {
  return dados.length >= 4 && dados[0] === 0x50 && dados[1] === 0x4b && dados[2] === 0x03 && dados[3] === 0x04;
}

export function verificarTamanho(bytes: number, limite = LIMITES_PLANILHA.maxBytes) {
  if (bytes > limite) throw new PlanilhaInvalida(`Arquivo grande demais (${mb(bytes)}; o limite é ${mb(limite)}).`);
}

/**
 * Confere um .xlsx (ZIP) sem abrir com o exceljs. Lança PlanilhaInvalida quando:
 * maior que maxBytes, ZIP corrompido/cifrado/ZIP64, partes demais, ou o conteúdo
 * descompactado passa de maxDescompactado (medido de verdade, não pelo cabeçalho).
 */
export function verificarXlsx(entrada: ArrayBuffer | Uint8Array, limites: Partial<typeof LIMITES_PLANILHA> = {}) {
  const lim = { ...LIMITES_PLANILHA, ...limites };
  const dados = entrada instanceof Uint8Array ? entrada : new Uint8Array(entrada);
  verificarTamanho(dados.length, lim.maxBytes);
  if (!ehZip(dados)) throw new PlanilhaInvalida("O arquivo não é uma planilha .xlsx válida. No UP, exporte em Excel (.xlsx).");
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);

  // Fim do diretório central (EOCD): assinatura 0x06054b50 nos últimos 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = dados.length - 22; i >= Math.max(0, dados.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PlanilhaInvalida("Planilha corrompida (não foi possível ler o arquivo .xlsx).");
  const total = v.getUint16(eocd + 10, true);
  const tamDir = v.getUint32(eocd + 12, true);
  const inicioDir = v.getUint32(eocd + 16, true);
  if (total === 0xffff || inicioDir === 0xffffffff) throw new PlanilhaInvalida("Planilha em formato não suportado (ZIP64).");
  if (total > lim.maxPartes) throw new PlanilhaInvalida(`Planilha com partes demais (${total}).`);
  if (inicioDir + tamDir > dados.length) throw new PlanilhaInvalida("Planilha corrompida (diretório fora do arquivo).");

  let restante = lim.maxDescompactado;
  let p = inicioDir;
  for (let n = 0; n < total; n++) {
    if (p + 46 > dados.length || v.getUint32(p, true) !== 0x02014b50) throw new PlanilhaInvalida("Planilha corrompida (diretório inválido).");
    const flags = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    const compactado = v.getUint32(p + 20, true);
    const descompactado = v.getUint32(p + 24, true);
    const tamNome = v.getUint16(p + 28, true);
    const tamExtra = v.getUint16(p + 30, true);
    const tamComent = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    p += 46 + tamNome + tamExtra + tamComent;

    if (flags & 0x1) throw new PlanilhaInvalida("Planilha protegida por senha: salve sem senha e envie de novo.");
    if (compactado === 0xffffffff || descompactado === 0xffffffff || local === 0xffffffff) throw new PlanilhaInvalida("Planilha em formato não suportado (ZIP64).");
    if (descompactado > restante) throw new PlanilhaInvalida(`Planilha grande demais ao abrir (passa de ${mb(lim.maxDescompactado)}).`);

    // Cabeçalho local: o tamanho do nome/extra pode diferir do diretório central.
    if (local + 30 > dados.length || v.getUint32(local, true) !== 0x04034b50) throw new PlanilhaInvalida("Planilha corrompida (parte inválida).");
    const inicio = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (inicio + compactado > dados.length) throw new PlanilhaInvalida("Planilha corrompida (parte cortada).");
    const bruto = dados.subarray(inicio, inicio + compactado);

    let real: number;
    if (metodo === 0) real = bruto.length;
    else if (metodo === 8) {
      try {
        // Teto real: o deflate não pode render mais que o orçamento que sobra (+1 para detectar o estouro).
        real = inflateRawSync(bruto, { maxOutputLength: Math.max(1, restante) + 1 }).length;
      } catch (e) {
        if (e instanceof RangeError || (e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
          throw new PlanilhaInvalida(`Planilha grande demais ao abrir (passa de ${mb(lim.maxDescompactado)}).`);
        throw new PlanilhaInvalida("Planilha corrompida (não foi possível descompactar).");
      }
    } else throw new PlanilhaInvalida("Planilha com compactação não suportada. Salve de novo como .xlsx.");
    if (real > restante) throw new PlanilhaInvalida(`Planilha grande demais ao abrir (passa de ${mb(lim.maxDescompactado)}).`);
    restante -= real;
  }
}

/** Depois de abrir: aba com linhas demais (o UP exporta no máximo alguns milhares). */
export function verificarLinhas(linhas: number, limite = LIMITES_PLANILHA.maxLinhas) {
  if (linhas > limite) throw new PlanilhaInvalida(`Planilha com linhas demais (${linhas.toLocaleString("pt-BR")}; o limite é ${limite.toLocaleString("pt-BR")}).`);
}
