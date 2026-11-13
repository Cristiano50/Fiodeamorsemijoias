/**
 * Referência interna e código de barras EAN-13.
 * Funções puras (sem banco) — usadas no servidor e no navegador.
 */

/** Dígito verificador EAN-13 (GS1) para os 12 primeiros dígitos. */
export function digitoEan13(doze: string): number {
  if (!/^\d{12}$/.test(doze)) throw new Error(`EAN-13 precisa de 12 dígitos: "${doze}"`);
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10;
}

export function eanValido(codigo: string): boolean {
  return /^\d{13}$/.test(codigo) && digitoEan13(codigo.slice(0, 12)) === Number(codigo[12]);
}

/** Monta um EAN-13 interno: prefixo + sequência (completada com zeros) + dígito verificador. */
export function montarEan13(prefixo: string, sequencia: number): string {
  if (!/^\d{1,8}$/.test(prefixo)) throw new Error("Prefixo do código de barras deve ter de 1 a 8 dígitos");
  const espaco = 12 - prefixo.length;
  const seq = String(sequencia);
  if (seq.length > espaco) throw new Error(`Sequência ${sequencia} não cabe no EAN-13 com prefixo ${prefixo}`);
  const doze = prefixo + seq.padStart(espaco, "0");
  return doze + digitoEan13(doze);
}

/**
 * Referência a partir de um modelo. Marcadores:
 *  {PREFIXO} → sigla do tipo (BR, AN, CL...)
 *  {AA} {AAAA} {MM} → ano/mês da data informada
 *  {SEQ:n} → sequência com n dígitos
 * Ex.: "{PREFIXO}_{AA}{MM}{SEQ:3}" → BR_2611001 ; "{PREFIXO}_{SEQ:7}" → BR_0000123
 */
export function montarReferencia(modelo: string, dados: { prefixo: string; sequencia: number; data?: Date }): string {
  const d = dados.data ?? new Date();
  const aaaa = String(d.getFullYear());
  return modelo
    .replace(/\{PREFIXO\}/g, dados.prefixo)
    .replace(/\{AAAA\}/g, aaaa)
    .replace(/\{AA\}/g, aaaa.slice(2))
    .replace(/\{MM\}/g, String(d.getMonth() + 1).padStart(2, "0"))
    .replace(/\{(S{2,})\}/g, (_, s: string) => String(dados.sequencia).padStart(s.length, "0"))
    .replace(/\{SEQ:(\d+)\}/g, (_, n) => String(dados.sequencia).padStart(Number(n), "0"))
    .replace(/\{SEQ\}/g, String(dados.sequencia));
}

/** Nome da sequência usada pelo modelo: por prefixo (cada tipo conta separado) ou global. */
export function chaveSequenciaReferencia(modelo: string, prefixo: string, data?: Date): string {
  const d = data ?? new Date();
  const porMes = /\{MM\}/.test(modelo);
  const mes = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `ref:${prefixo}${porMes ? ":" + mes : ""}`;
}
