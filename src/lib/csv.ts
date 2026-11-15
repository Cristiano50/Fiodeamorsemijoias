/**
 * Células de CSV seguras para abrir no Excel/Planilhas: texto que começa com = + - @ (ou tab/enter)
 * vira fórmula ao abrir; prefixamos com apóstrofo. Números (tipo number) ficam como estão.
 * Sem "server-only": também usado no cliente.
 */
export function textoSeguroPlanilha(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Célula CSV separada por ";" (padrão brasileiro do app): número com vírgula, Sim/Não, aspas quando preciso. */
export function celulaCsv(v: unknown, sep = ";"): string {
  let s: string;
  if (typeof v === "boolean") s = v ? "Sim" : "Não";
  else if (typeof v === "number") s = Number.isFinite(v) ? String(v).replace(".", ",") : "";
  else s = textoSeguroPlanilha(String(v ?? ""));
  return s.includes(sep) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
