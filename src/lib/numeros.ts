/**
 * Números digitados em campos da tela, no jeito brasileiro ou não.
 * Sem "server-only": usado nas telas (cliente) e nas rotas (servidor).
 *
 *   lerNumeroBr("850,50") → 850.5      lerNumeroBr("1.234,56") → 1234.56
 *   lerNumeroBr("850.50") → 850.5      lerNumeroBr("1,234.56") → 1234.56
 *   lerNumeroBr("850.5")  → 850.5      lerNumeroBr("R$ 1.234") → 1234 (milhar)
 *   lerNumeroBr("0,7745") → 0.7745     lerNumeroBr("0.775", { milhar: false }) → 0.775
 *
 * Regra do ponto sozinho: com `milhar` (padrão, para dinheiro), "1.234" e "12.345.678" são milhar;
 * qualquer outra coisa ("850.5", "850.50", "0.775", "3.1415") é decimal. Use `milhar: false` em cotação e fator.
 */
export function lerNumeroBr(texto: unknown, opcoes: { milhar?: boolean } = {}): number | null {
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : null;
  if (texto == null) return null;
  let s = String(texto)
    .replace(/R\$|US\$|¥|CN¥|RMB|\s| /gi, "")
    .trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negativo = !negativo;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // O último separador é o decimal.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (temVirgula) {
    if ((s.match(/,/g) ?? []).length > 1) return null; // "1,2,3"
    s = s.replace(",", ".");
  } else if (temPonto) {
    const partes = s.split(".");
    const milhar = (opcoes.milhar ?? true) && partes.length >= 2 && partes[0] !== "0" && partes[0] !== "" && partes.slice(1).every((p) => p.length === 3);
    if (milhar) s = partes.join("");
    else if (partes.length > 2) return null; // "1.2.3"
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/** Número para mostrar num campo editável: "850,5" → "850,50"; inteiros sem casas ("10"). */
export function numeroParaCampo(n: number | null | undefined, casas = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (Number.isInteger(n) && casas <= 2) return String(n);
  return n.toLocaleString("pt-BR", { minimumFractionDigits: Math.min(casas, 2), maximumFractionDigits: casas, useGrouping: false });
}
