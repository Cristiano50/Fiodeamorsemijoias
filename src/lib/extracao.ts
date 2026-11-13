/**
 * Leitura heurística de uma linha de pedido de fornecedor (funciona sem IA).
 * Ex.: "1 | GSH747A | 耳钉-21# | GSH747A | G | 10 | 12 | 120"
 *  → código GSH747A, descrição 耳钉-21#, especificação G, preço 10, quantidade 12, total 120.
 * A IA refina depois; aqui garantimos números corretos quando preço × qtd = total.
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
const temCjk = (s: string) => /[㐀-鿿]/.test(s);

export function lerLinha(texto: string): LinhaLida {
  const partes = texto
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: LinhaLida = {};

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
        const antes = partes[i - 1];
        if (antes && !ehNumero(antes) && antes.length <= 12 && !temCjk(antes.replace(/[白蓝粉黑红绿金银油达]/g, "")))
          out.especificacao = antes;
        break;
      }
    }
  }

  const codigo = partes.find((s) => /^[A-Za-z]{1,6}\d{2,6}[A-Za-z]{0,3}(?:\/[A-Za-z0-9]+)?$/.test(s));
  if (codigo) out.codigo = codigo.toUpperCase();
  const desc = partes.filter((s) => temCjk(s) && s !== out.especificacao);
  if (desc.length) out.descricao = desc.join(" ");
  return out;
}

/** Procura data (AAAA-MM-DD) e número do pedido no cabeçalho do documento. */
export function lerCabecalho(texto: string): { data?: string; numero?: string; moeda?: string } {
  const out: { data?: string; numero?: string; moeda?: string } = {};
  const d = texto.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (d) out.data = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
  const n = texto.match(/(?:单号|订单号|No\.?|Pedido|Order)\s*[:：#]?\s*([A-Za-z0-9-]{4,})/i);
  if (n) out.numero = n[1];
  if (temCjk(texto) || /¥|RMB|CNY|元/.test(texto)) out.moeda = "CNY";
  else if (/R\$/.test(texto)) out.moeda = "BRL";
  else if (/US\$|USD/.test(texto)) out.moeda = "USD";
  return out;
}
