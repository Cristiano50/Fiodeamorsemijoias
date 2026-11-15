import { lerNumeroBr } from "./numeros";

/**
 * Leitura heurística de uma linha de pedido de fornecedor (funciona sem IA).
 * Ex.: "1 | ABC123A | 耳钉-21# | ABC123A | G | 10 | 12 | 120"
 *  → código ABC123A, descrição 耳钉-21#, especificação G, preço 10, quantidade 12, total 120.
 * A IA refina depois; aqui garantimos números corretos quando preço × qtd = total.
 * Funções puras (sem banco): usadas no navegador, no servidor e nos testes (tests/vetores/*.json, os mesmos da skill).
 */
export interface LinhaLida {
  codigo?: string;
  descricao?: string;
  especificacao?: string;
  preco?: number;
  quantidade?: number;
  total?: number;
}

const ehNumero = (s: string) => /^\d+(?:[.,]\d+)?$/.test(s);
const num = (s: string) => Number(s.replace(",", "."));
// Ideogramas chineses (CJK unificados + extensão A e compatibilidade). Sem flag "u": coreano, uso privado e
// caracteres fora do plano básico (pares substitutos) não contam como chinês — igual à skill.
const temCjk = (s: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(s);
const tamanho = (s: string) => Array.from(s).length;
const RE_CODIGO = /^[A-Za-z]{1,6}\d{2,6}[A-Za-z]{0,3}(?:\/[A-Za-z0-9]+)?$/;

/**
 * Especificação/cor do fornecedor (G, MR, 14KF, 金色, 玫瑰金, 16, 18号…): a célula imediatamente antes do trio
 * preço × quantidade = total. Vazia quando a célula é a 1ª (sequência), o próprio código repetido ou a descrição
 * (texto com caractere chinês sem outra célula de texto antes dela). Texto latino até 16 caracteres ou número
 * (tamanho) vale; texto com caractere chinês vale até 12 caracteres quando há uma descrição antes.
 */
function especificacaoAntes(partes: string[], iTrio: number, codigo: string | undefined): string | undefined {
  const k = iTrio - 1;
  if (k <= 0) return undefined; // nada antes, ou é a 1ª célula (sequência)
  const cel = partes[k];
  const ehCodigo = (s: string) => !!codigo && s.toUpperCase() === codigo;
  if (ehCodigo(cel)) return undefined;
  if (temCjk(cel)) {
    // Célula de texto antes (nem a sequência, nem número, nem o código): é a descrição; esta é a especificação.
    const descricaoAntes = partes.slice(0, k).some((s) => !ehNumero(s) && !ehCodigo(s));
    return descricaoAntes && tamanho(cel) <= 12 ? cel : undefined;
  }
  if (ehNumero(cel)) return cel; // tamanho (16, 18…)
  return tamanho(cel) <= 16 ? cel : undefined;
}

export function lerLinha(texto: string): LinhaLida {
  const partes = texto
    .normalize("NFKC") // letras e números de largura total (ＡＢＣ１２３) viram ASCII
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: LinhaLida = {};
  const codigo = partes.find((s) => RE_CODIGO.test(s));
  if (codigo) out.codigo = codigo.toUpperCase();

  // Preço × quantidade = total (três números seguidos).
  for (let i = 0; i + 2 < partes.length; i++) {
    const [a, b, c] = partes.slice(i, i + 3);
    if (ehNumero(a) && ehNumero(b) && ehNumero(c)) {
      const p = num(a);
      const q = num(b);
      const t = num(c);
      if (Number.isInteger(q) && q > 0 && Math.abs(p * q - t) <= Math.max(0.02, t * 0.005)) {
        out.preco = p;
        out.quantidade = q;
        out.total = t;
        const esp = especificacaoAntes(partes, i, out.codigo);
        if (esp) out.especificacao = esp;
        break;
      }
    }
  }

  const desc = partes.filter((s) => temCjk(s) && s !== out.especificacao);
  if (desc.length) out.descricao = desc.join(" ");
  return out;
}

export type MoedaDocumento = "USD" | "BRL" | "CNY";

/** Marcas de moeda no documento, em ordem de prioridade (dólar > real > yuan). */
const MOEDAS: [MoedaDocumento, RegExp][] = [
  ["USD", /US\$|\bUSD\b|美元|美金/i],
  ["BRL", /R\$|\bBRL\b|雷亚尔/i],
  ["CNY", /[¥￥]|\bRMB\b|\bCNY\b|人民币|元/i],
];

/**
 * Procura data (AAAA-MM-DD), número do pedido e moeda no cabeçalho do documento.
 * Moeda: USD (USD, US$, 美元, 美金) > BRL (R$, BRL, 雷亚尔) > CNY (¥, RMB, CNY, 人民币, 元). Sem marca: null
 * (não adivinha pelo chinês; a tela mantém CNY e pede para conferir).
 */
export function lerCabecalho(texto: string): { data?: string; numero?: string; moeda: MoedaDocumento | null } {
  const out: { data?: string; numero?: string; moeda: MoedaDocumento | null } = { moeda: null };
  const d = texto.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (d) out.data = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
  const n = texto.match(/(?:单号|订单号|No\.?|Pedido|Order)\s*[:：#]?\s*([A-Za-z0-9-]{4,})/i);
  if (n) out.numero = n[1];
  out.moeda = MOEDAS.find(([, re]) => re.test(texto))?.[0] ?? null;
  return out;
}

/* ------------------------------------------------- pacote da skill do Claude */

/** Quantidade de uma peça do pacote: 0 continua 0 (com alerta); ausente vira 1 (com alerta); aceita texto ("12", "12,0"). */
export function quantidadeDoPacote(v: unknown): { quantidade: number; alerta: string | null } {
  const q = lerNumeroBr(v);
  if (q == null) return { quantidade: 1, alerta: "Quantidade ausente no pacote: ficou 1, confira." };
  const quantidade = Math.max(0, Math.round(q));
  return { quantidade, alerta: quantidade === 0 ? "Quantidade 0 no pacote." : null };
}

/**
 * Número da linha de cada peça do pacote, sem duplicar no reenvio:
 *  - linha válida e livre → fica;
 *  - linha já gravada com a mesma peça (mesma `marca`) → reenvio, pula (null);
 *  - linha repetida, ausente ou já usada por outra peça → numera em sequência depois da maior linha (e avisa);
 *    no reenvio, a mesma peça já gravada (mesma marca) é reconhecida e pulada.
 * `marca` = impressão digital da peça (código, especificação, texto, preço, quantidade).
 * `depoisDe` (ex.: o total de itens do pacote em partes): as renumeradas vêm depois dele, para não pegar o número
 * de uma linha válida que ainda vai chegar em outra parte.
 */
export function numerarLinhasPacote(
  itens: { linha: unknown; marca: string }[],
  existentes: { linha: number; marca: string }[],
  depoisDe = 0,
): { linhas: (number | null)[]; renumeradas: { de: string; para: number }[]; reenvios: number } {
  const porLinha = new Map(existentes.map((e) => [e.linha, e.marca]));
  const marcasGravadas = new Set(existentes.map((e) => e.marca));
  const usadas = new Set(existentes.map((e) => e.linha));
  const vistas = new Set<number>();
  const linhas: (number | null)[] = itens.map(() => null);
  const renumerar: number[] = [];
  let reenvios = 0;
  itens.forEach((it, idx) => {
    const bruto = typeof it.linha === "string" ? it.linha.trim() : it.linha;
    const n = Number(bruto);
    const valida = bruto !== null && bruto !== undefined && bruto !== "" && Number.isInteger(n) && n > 0;
    if (valida && !vistas.has(n)) {
      vistas.add(n);
      if (porLinha.has(n)) {
        if (porLinha.get(n) === it.marca) reenvios++;
        else renumerar.push(idx); // o número já é de outra peça
        return;
      }
      linhas[idx] = n;
      usadas.add(n);
      return;
    }
    if (marcasGravadas.has(it.marca)) {
      reenvios++; // reenvio de uma peça que já tinha sido renumerada
      return;
    }
    renumerar.push(idx);
  });
  const renumeradas: { de: string; para: number }[] = [];
  let proxima = Number.isInteger(depoisDe) && depoisDe > 0 ? depoisDe + 1 : 1;
  for (const n of [...usadas, ...vistas]) if (n >= proxima) proxima = n + 1;
  for (const idx of renumerar) {
    while (usadas.has(proxima) || vistas.has(proxima)) proxima++;
    linhas[idx] = proxima;
    usadas.add(proxima);
    const de = itens[idx].linha;
    renumeradas.push({ de: de === null || de === undefined || de === "" ? "sem número" : String(de), para: proxima });
    proxima++;
  }
  return { linhas, renumeradas, reenvios };
}
