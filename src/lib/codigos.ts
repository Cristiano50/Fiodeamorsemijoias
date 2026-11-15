/**
 * Referência interna, código de barras EAN-13 e chave da recompra.
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

/**
 * Lê sequência, ano e mês de uma referência pelo modelo.
 * Ex.: "{PREFIXO}_{AA}{MM}{SEQ:3}" e "BR_2611034" → { sequencia: 34, ano: 2026, mes: 11 }.
 * Serve para o contador do mês certo avançar quando a referência veio pronta (skill do Claude).
 */
export function lerReferencia(
  modelo: string,
  prefixo: string,
  referencia: string,
): { sequencia: number; ano: number | null; mes: number | null } | null {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re = "";
  let resto = modelo;
  const grupos: ("seq" | "aaaa" | "aa" | "mm" | null)[] = [];
  while (resto.length) {
    const m = /^\{(PREFIXO|AAAA|AA|MM|S{2,}|SEQ:\d+|SEQ)\}/.exec(resto);
    if (m) {
      const tok = m[1];
      if (tok === "PREFIXO") re += esc(prefixo);
      else {
        const g = tok === "AAAA" ? "aaaa" : tok === "AA" ? "aa" : tok === "MM" ? "mm" : "seq";
        re += g === "aaaa" ? "(\\d{4})" : g === "seq" ? "(\\d+)" : "(\\d{2})";
        grupos.push(g);
      }
      resto = resto.slice(m[0].length);
    } else {
      re += esc(resto[0]);
      resto = resto.slice(1);
    }
  }
  if (!grupos.includes("seq")) return null;
  const r = new RegExp(`^${re}$`, "i").exec(referencia.trim());
  if (!r) return null;
  const valor = (g: string) => {
    const i = grupos.indexOf(g as (typeof grupos)[number]);
    return i >= 0 ? Number(r[i + 1]) : null;
  };
  const aaaa = valor("aaaa");
  const aa = valor("aa");
  const mm = valor("mm");
  return {
    sequencia: valor("seq")!,
    ano: aaaa ?? (aa != null ? 2000 + aa : null),
    mes: mm != null && mm >= 1 && mm <= 12 ? mm : null,
  };
}

/* ------------------------------------------------------------- recompra */

/**
 * Normalização da chave da recompra (código do fornecedor e especificação):
 * largura total → ASCII (NFKC), maiúsculas, sem espaço, hífen ou ponto. "abc-123 a" = "ＡＢＣ１２３Ａ" = "ABC123A".
 * A skill do Claude usa a mesma regra (o contexto manda a chave pronta de cada peça já cadastrada).
 */
export const normalizarChave = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s.\-]+/g, "");

/** Chave da recompra: fornecedor (chaveFornecedor: nome original sem espaços, minúsculas) + código + especificação. */
export const chaveRecompra = (fornecedorChave: string | null | undefined, codigo: string | null | undefined, especificacao: string | null | undefined) =>
  `${fornecedorChave ?? ""}|${normalizarChave(codigo)}|${normalizarChave(especificacao)}`;

export interface PecaRecompra {
  codigo: string | null;
  especificacao: string | null;
  fornecedorChave: string; // "" = sem fornecedor
}
export interface OriginalRecompra extends PecaRecompra {
  id: string;
  criadoEm?: string | null;
}

/**
 * Decide a recompra de uma peça nova contra os originais já cadastrados (de outros pedidos, com referência).
 *  - Original possível: mesmo código; fornecedor igual (ou desconhecido de um dos lados); especificação igual ou vazia de um dos lados.
 *  - Automática só quando há exatamente 1 possível e ele casa a chave inteira (fornecedor conhecido nos dois lados e mesma especificação).
 *  - Senão, com algum possível: sugestão (recompra a confirmar), nunca automática. Pedido sem fornecedor = só sugestão.
 */
export function classificarRecompra(peca: PecaRecompra, originais: OriginalRecompra[]): { automatico: string | null; candidatas: string[] } {
  const codigo = normalizarChave(peca.codigo);
  if (!codigo) return { automatico: null, candidatas: [] };
  const esp = normalizarChave(peca.especificacao);
  const forn = peca.fornecedorChave ?? "";
  const possiveis = originais
    .filter((o) => {
      if (normalizarChave(o.codigo) !== codigo) return false;
      const f = o.fornecedorChave ?? "";
      if (forn && f && f !== forn) return false;
      const e = normalizarChave(o.especificacao);
      return e === esp || !e || !esp;
    })
    .sort((a, b) => String(a.criadoEm ?? "").localeCompare(String(b.criadoEm ?? "")));
  const exatos = possiveis.filter((o) => !!forn && o.fornecedorChave === forn && normalizarChave(o.especificacao) === esp);
  if (possiveis.length === 1 && exatos.length === 1) return { automatico: exatos[0].id, candidatas: [] };
  return { automatico: null, candidatas: possiveis.map((o) => o.id) };
}
